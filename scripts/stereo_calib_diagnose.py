#!/usr/bin/env python3
# ============================================================
# 立体标定质量诊断脚本
# 对比不同标定策略在 RMS、极线误差、纠正后上下视差上的表现
# 用法：python3 scripts/stereo_calib_diagnose.py
# ============================================================

import os
import xml.etree.ElementTree as ET
import numpy as np
import cv2

DATA_DIR = '/Users/zhengwei/code/opencv/samples/data'
XML_PATH = os.path.join(DATA_DIR, 'stereo_calib.xml')
OUT_DIR = os.path.join(os.path.dirname(__file__), 'stereo_output')
os.makedirs(OUT_DIR, exist_ok=True)

BOARD_SIZE = (9, 6)
SQUARE_SIZE = 1.0


def parse_image_list(xml_path: str):
    tree = ET.parse(xml_path)
    text = tree.find('imagelist').text
    return [line.strip().strip('"\'') for line in text.splitlines() if line.strip()]


def detect_corners(data_dir, imagelist, board_size):
    objp = np.zeros((board_size[0] * board_size[1], 3), np.float32)
    objp[:, :2] = np.mgrid[0:board_size[0], 0:board_size[1]].T.reshape(-1, 2) * SQUARE_SIZE

    objpoints = []
    imgpoints_l = []
    imgpoints_r = []
    good_pairs = []
    image_size = None

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)

    for i in range(0, len(imagelist), 2):
        left_path = os.path.join(data_dir, imagelist[i])
        right_path = os.path.join(data_dir, imagelist[i + 1])

        img_l = cv2.imread(left_path)
        img_r = cv2.imread(right_path)
        if img_l is None or img_r is None:
            continue

        gray_l = cv2.cvtColor(img_l, cv2.COLOR_BGR2GRAY)
        gray_r = cv2.cvtColor(img_r, cv2.COLOR_BGR2GRAY)
        if image_size is None:
            image_size = (gray_l.shape[1], gray_l.shape[0])

        ret_l, corners_l = cv2.findChessboardCorners(gray_l, board_size, None)
        ret_r, corners_r = cv2.findChessboardCorners(gray_r, board_size, None)
        if not (ret_l and ret_r):
            continue

        cv2.cornerSubPix(gray_l, corners_l, (11, 11), (-1, -1), criteria)
        cv2.cornerSubPix(gray_r, corners_r, (11, 11), (-1, -1), criteria)

        objpoints.append(objp)
        imgpoints_l.append(corners_l)
        imgpoints_r.append(corners_r)
        good_pairs.append((imagelist[i], imagelist[i + 1]))

    return objpoints, imgpoints_l, imgpoints_r, good_pairs, image_size


def mono_calibrate(objpoints, imgpoints, image_size):
    rms, K, D, rvecs, tvecs = cv2.calibrateCamera(
        objpoints, imgpoints, image_size, None, None,
        criteria=(cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-6)
    )
    return rms, K, D, rvecs, tvecs


def stereo_calibrate(objpoints, imgpoints_l, imgpoints_r, K_l, D_l, K_r, D_r, image_size, flags):
    criteria = (cv2.TERM_CRITERIA_MAX_ITER + cv2.TERM_CRITERIA_EPS, 100, 1e-6)
    rms, K1, D1, K2, D2, R, T, E, F = cv2.stereoCalibrate(
        objpoints, imgpoints_l, imgpoints_r,
        K_l.copy(), D_l.copy(), K_r.copy(), D_r.copy(),
        image_size, None, None,
        flags=flags,
        criteria=criteria,
    )
    return rms, K1, D1, K2, D2, R, T, E, F


def epipolar_error(imgpoints_l, imgpoints_r, F):
    """用 F 矩阵计算极线距离（越小越好）"""
    errors = []
    for pts_l, pts_r in zip(imgpoints_l, imgpoints_r):
        pts_l = pts_l.reshape(-1, 2)
        pts_r = pts_r.reshape(-1, 2)

        lines1 = cv2.computeCorrespondEpilines(pts_r.reshape(-1, 1, 2), 2, F).reshape(-1, 3)
        dist1 = np.abs(np.sum(pts_l * lines1[:, :2], axis=1) + lines1[:, 2])

        lines2 = cv2.computeCorrespondEpilines(pts_l.reshape(-1, 1, 2), 1, F).reshape(-1, 3)
        dist2 = np.abs(np.sum(pts_r * lines2[:, :2], axis=1) + lines2[:, 2])

        errors.extend(dist1.tolist())
        errors.extend(dist2.tolist())
    return float(np.mean(errors))


def rectified_vertical_disparity(imgpoints_l, imgpoints_r, K1, D1, K2, D2, R, T, image_size):
    """纠正后同名点的 |y_L - y_R|（越小越好）"""
    R1, R2, P1, P2, Q, roi1, roi2 = cv2.stereoRectify(
        K1, D1, K2, D2, image_size, R, T,
        alpha=0.0,
        flags=cv2.CALIB_ZERO_DISPARITY,
    )

    diffs = []
    for pts_l, pts_r in zip(imgpoints_l, imgpoints_r):
        rect_l = cv2.undistortPoints(pts_l, K1, D1, R=R1, P=P1).reshape(-1, 2)
        rect_r = cv2.undistortPoints(pts_r, K2, D2, R=R2, P=P2).reshape(-1, 2)
        diffs.extend(np.abs(rect_l[:, 1] - rect_r[:, 1]).tolist())
    return float(np.mean(diffs)), float(np.max(diffs))


def evaluate(name, objpoints, imgpoints_l, imgpoints_r, K1, D1, K2, D2, R, T, F, image_size):
    epi = epipolar_error(imgpoints_l, imgpoints_r, F)
    vdisp_mean, vdisp_max = rectified_vertical_disparity(
        imgpoints_l, imgpoints_r, K1, D1, K2, D2, R, T, image_size
    )
    return {
        'name': name,
        'epi_error': epi,
        'vdisp_mean': vdisp_mean,
        'vdisp_max': vdisp_max,
    }


def main():
    objpoints, imgpoints_l, imgpoints_r, good_pairs, image_size = detect_corners(
        DATA_DIR, parse_image_list(XML_PATH), BOARD_SIZE
    )
    print(f'有效标定对: {len(good_pairs)}，图像尺寸: {image_size}\n')

    # 1. 单目标定（作为 stereoCalibrate 的初值或固定内参）
    rms_l, K_l, D_l, _, _ = mono_calibrate(objpoints, imgpoints_l, image_size)
    rms_r, K_r, D_r, _, _ = mono_calibrate(objpoints, imgpoints_r, image_size)
    print(f'单目标定 RMS: 左={rms_l:.4f}, 右={rms_r:.4f}\n')

    results = []

    # 2. 固定内参（只优化 R/T/E/F）
    srms, K1, D1, K2, D2, R, T, E, F = stereo_calibrate(
        objpoints, imgpoints_l, imgpoints_r,
        K_l, D_l, K_r, D_r, image_size,
        flags=cv2.CALIB_FIX_INTRINSIC
    )
    res = evaluate('FIX_INTRINSIC', objpoints, imgpoints_l, imgpoints_r,
                   K1, D1, K2, D2, R, T, F, image_size)
    res['stereo_rms'] = srms
    results.append(res)

    # 3. 联合优化（同时优化 K/D/R/T）
    srms, K1, D1, K2, D2, R, T, E, F = stereo_calibrate(
        objpoints, imgpoints_l, imgpoints_r,
        K_l, D_l, K_r, D_r, image_size,
        flags=0
    )
    res = evaluate('JOINT', objpoints, imgpoints_l, imgpoints_r,
                   K1, D1, K2, D2, R, T, F, image_size)
    res['stereo_rms'] = srms
    results.append(res)

    # 4. 固定内参但 R/T 方向反了（常见错误）
    srms, K1, D1, K2, D2, R, T, E, F = stereo_calibrate(
        objpoints, imgpoints_l, imgpoints_r,
        K_l, D_l, K_r, D_r, image_size,
        flags=cv2.CALIB_FIX_INTRINSIC
    )
    res = evaluate('FIX_INTRINSIC + R.T/-T', objpoints, imgpoints_l, imgpoints_r,
                   K1, D1, K2, D2, R.T, -T, F, image_size)
    res['stereo_rms'] = srms
    results.append(res)

    # 5. 联合优化但 R/T 方向反了
    srms, K1, D1, K2, D2, R, T, E, F = stereo_calibrate(
        objpoints, imgpoints_l, imgpoints_r,
        K_l, D_l, K_r, D_r, image_size,
        flags=0
    )
    res = evaluate('JOINT + R.T/-T', objpoints, imgpoints_l, imgpoints_r,
                   K1, D1, K2, D2, R.T, -T, F, image_size)
    res['stereo_rms'] = srms
    results.append(res)

    # 打印表格
    print(f'{"策略":25s} {"Stereo RMS":>12s} {"极线误差":>12s} {"纠正后 y 差(平均)":>18s} {"纠正后 y 差(最大)":>18s}')
    print('-' * 90)
    for r in results:
        print(f'{r["name"]:25s} {r["stereo_rms"]:12.4f} {r["epi_error"]:12.4f} '
              f'{r["vdisp_mean"]:18.4f} {r["vdisp_max"]:18.4f}')

    # 保存文本结果
    out_txt = os.path.join(OUT_DIR, 'stereo_diagnose.txt')
    with open(out_txt, 'w', encoding='utf-8') as f:
        f.write(f'有效标定对: {len(good_pairs)}，图像尺寸: {image_size}\n')
        f.write(f'单目标定 RMS: 左={rms_l:.4f}, 右={rms_r:.4f}\n\n')
        f.write(f'{"策略":25s} {"Stereo RMS":>12s} {"极线误差":>12s} '
                f'{"纠正后 y 差(平均)":>18s} {"纠正后 y 差(最大)":>18s}\n')
        f.write('-' * 90 + '\n')
        for r in results:
            f.write(f'{r["name"]:25s} {r["stereo_rms"]:12.4f} {r["epi_error"]:12.4f} '
                    f'{r["vdisp_mean"]:18.4f} {r["vdisp_max"]:18.4f}\n')
    print(f'\n已保存诊断报告: {out_txt}')


if __name__ == '__main__':
    main()
