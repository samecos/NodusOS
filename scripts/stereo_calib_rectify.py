#!/usr/bin/env python3
# ============================================================
# OpenCV samples/data/stereo_calib.xml 立体标定 + 纠正示例
# 用法：python3 scripts/stereo_calib_rectify.py
# 输出：scripts/stereo_output/rectified_pair.png
#       scripts/stereo_output/stereo_params.yml
# ============================================================

import os
import xml.etree.ElementTree as ET
import numpy as np
import cv2

DATA_DIR = '/Users/zhengwei/code/opencv/samples/data'
XML_PATH = os.path.join(DATA_DIR, 'stereo_calib.xml')
OUT_DIR = os.path.join(os.path.dirname(__file__), 'stereo_output')
os.makedirs(OUT_DIR, exist_ok=True)

BOARD_SIZE = (9, 6)          # 内角点数，与 OpenCV 示例默认一致
SQUARE_SIZE = 1.0            # 方格尺寸，单位为任意单位
ALPHA = 0.0                  # 0=裁剪到有效 ROI，1=保留全部像素


def parse_image_list(xml_path: str):
    tree = ET.parse(xml_path)
    text = tree.find('imagelist').text
    return [line.strip().strip('"\'') for line in text.splitlines() if line.strip()]


def main():
    imagelist = parse_image_list(XML_PATH)
    if len(imagelist) % 2 != 0:
        raise ValueError('图像列表必须是左右成对出现')

    objp = np.zeros((BOARD_SIZE[0] * BOARD_SIZE[1], 3), np.float32)
    objp[:, :2] = np.mgrid[0:BOARD_SIZE[0], 0:BOARD_SIZE[1]].T.reshape(-1, 2) * SQUARE_SIZE

    objpoints = []
    imgpoints_l = []
    imgpoints_r = []
    good_pairs = []

    criteria_subpix = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)

    for i in range(0, len(imagelist), 2):
        left_name = imagelist[i]
        right_name = imagelist[i + 1]
        left_path = os.path.join(DATA_DIR, left_name)
        right_path = os.path.join(DATA_DIR, right_name)

        img_l = cv2.imread(left_path)
        img_r = cv2.imread(right_path)
        if img_l is None or img_r is None:
            print(f'[skip] 无法读取 {left_name} / {right_name}')
            continue

        gray_l = cv2.cvtColor(img_l, cv2.COLOR_BGR2GRAY)
        gray_r = cv2.cvtColor(img_r, cv2.COLOR_BGR2GRAY)

        ret_l, corners_l = cv2.findChessboardCorners(gray_l, BOARD_SIZE, None)
        ret_r, corners_r = cv2.findChessboardCorners(gray_r, BOARD_SIZE, None)

        if not (ret_l and ret_r):
            print(f'[skip] 未找到棋盘格 {left_name} / {right_name}')
            continue

        cv2.cornerSubPix(gray_l, corners_l, (11, 11), (-1, -1), criteria_subpix)
        cv2.cornerSubPix(gray_r, corners_r, (11, 11), (-1, -1), criteria_subpix)

        objpoints.append(objp)
        imgpoints_l.append(corners_l)
        imgpoints_r.append(corners_r)
        good_pairs.append((left_name, right_name))
        print(f'[ ok ] {left_name} <-> {right_name}')

    print(f'\n有效标定对: {len(good_pairs)} / {len(imagelist) // 2}')
    if len(good_pairs) < 3:
        raise RuntimeError('有效标定对太少，无法完成立体标定')

    h, w = gray_l.shape[:2]
    image_size = (w, h)

    # 单目标定
    ret_l, K_l, D_l, _, _ = cv2.calibrateCamera(objpoints, imgpoints_l, image_size, None, None)
    ret_r, K_r, D_r, _, _ = cv2.calibrateCamera(objpoints, imgpoints_r, image_size, None, None)
    print(f'左相机 RMS: {ret_l:.4f}')
    print(f'右相机 RMS: {ret_r:.4f}')

    # 双目标定（固定内参，只优化 R/T/E/F）
    criteria_stereo = (cv2.TERM_CRITERIA_MAX_ITER + cv2.TERM_CRITERIA_EPS, 30, 1e-6)
    ret, K1, D1, K2, D2, R, T, E, F = cv2.stereoCalibrate(
        objpoints, imgpoints_l, imgpoints_r,
        K_l, D_l, K_r, D_r,
        image_size, None, None,
        flags=cv2.CALIB_FIX_INTRINSIC,
        criteria=criteria_stereo,
    )
    print(f'双目 RMS: {ret:.4f}')

    # 立体纠正
    R1, R2, P1, P2, Q, roi1, roi2 = cv2.stereoRectify(
        K1, D1, K2, D2, image_size, R, T,
        alpha=ALPHA,
        flags=cv2.CALIB_ZERO_DISPARITY,
    )
    print(f'ROI1: {roi1}')
    print(f'ROI2: {roi2}')

    map1x, map1y = cv2.initUndistortRectifyMap(K1, D1, R1, P1, image_size, cv2.CV_32FC1)
    map2x, map2y = cv2.initUndistortRectifyMap(K2, D2, R2, P2, image_size, cv2.CV_32FC1)

    # 用第一对有效图像做纠正可视化
    left0 = cv2.imread(os.path.join(DATA_DIR, good_pairs[0][0]))
    right0 = cv2.imread(os.path.join(DATA_DIR, good_pairs[0][1]))
    rect_left = cv2.remap(left0, map1x, map1y, cv2.INTER_LINEAR)
    rect_right = cv2.remap(right0, map2x, map2y, cv2.INTER_LINEAR)

    # 裁剪到有效 ROI 并拼接
    if roi1[2] > 0 and roi1[3] > 0:
        rect_left = rect_left[roi1[1]:roi1[1] + roi1[3], roi1[0]:roi1[0] + roi1[2]]
    if roi2[2] > 0 and roi2[3] > 0:
        rect_right = rect_right[roi2[1]:roi2[1] + roi2[3], roi2[0]:roi2[0] + roi2[2]]

    # 统一高度后横向拼接
    h_min = min(rect_left.shape[0], rect_right.shape[0])
    rect_left = rect_left[:h_min]
    rect_right = rect_right[:h_min]
    side_by_side = np.hstack((rect_left, rect_right))

    # 画水平核线
    step = 40
    for y in range(0, side_by_side.shape[0], step):
        cv2.line(side_by_side, (0, y), (side_by_side.shape[1], y), (0, 255, 0), 1)

    out_img = os.path.join(OUT_DIR, 'rectified_pair.png')
    cv2.imwrite(out_img, side_by_side)
    print(f'\n已保存纠正结果: {out_img}')

    # 保存标定参数
    params_path = os.path.join(OUT_DIR, 'stereo_params.yml')
    fs = cv2.FileStorage(params_path, cv2.FILE_STORAGE_WRITE)
    fs.write('image_width', w)
    fs.write('image_height', h)
    fs.write('K1', K1)
    fs.write('D1', D1)
    fs.write('K2', K2)
    fs.write('D2', D2)
    fs.write('R', R)
    fs.write('T', T)
    fs.write('E', E)
    fs.write('F', F)
    fs.write('R1', R1)
    fs.write('R2', R2)
    fs.write('P1', P1)
    fs.write('P2', P2)
    fs.write('Q', Q)
    fs.write('roi1', np.array(roi1))
    fs.write('roi2', np.array(roi2))
    fs.release()
    print(f'已保存标定参数: {params_path}')


if __name__ == '__main__':
    main()
