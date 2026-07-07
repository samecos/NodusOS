#!/usr/bin/env python3
# ============================================================
# 不同 alpha 与 CALIB_ZERO_DISPARITY 组合的立体纠正效果对比
# 依赖：scripts/stereo_output/stereo_params.yml（由上一步标定脚本生成）
# 输出：scripts/stereo_output/rectify_matrix.png
# ============================================================

import os
import xml.etree.ElementTree as ET
import numpy as np
import cv2

DATA_DIR = '/Users/zhengwei/code/opencv/samples/data'
XML_PATH = os.path.join(DATA_DIR, 'stereo_calib.xml')
PARAMS_PATH = os.path.join(os.path.dirname(__file__), 'stereo_output', 'stereo_params.yml')
OUT_DIR = os.path.join(os.path.dirname(__file__), 'stereo_output')
os.makedirs(OUT_DIR, exist_ok=True)


def parse_image_list(xml_path: str):
    tree = ET.parse(xml_path)
    text = tree.find('imagelist').text
    return [line.strip().strip('"\'') for line in text.splitlines() if line.strip()]


def add_label(img, text):
    h, w = img.shape[:2]
    # 底部加 35px 黑色条放文字
    label_h = 35
    labeled = np.vstack((img, np.zeros((label_h, w, 3), dtype=np.uint8)))
    cv2.putText(labeled, text, (10, h + 24), cv2.FONT_HERSHEY_SIMPLEX,
                0.65, (0, 255, 0), 2, cv2.LINE_AA)
    return labeled


def main():
    # 读取标定参数
    fs = cv2.FileStorage(PARAMS_PATH, cv2.FILE_STORAGE_READ)
    if not fs.isOpened():
        raise FileNotFoundError(f'找不到标定参数文件: {PARAMS_PATH}，请先运行 stereo_calib_rectify.py')
    w = int(fs.getNode('image_width').real())
    h = int(fs.getNode('image_height').real())
    K1 = fs.getNode('K1').mat()
    D1 = fs.getNode('D1').mat()
    K2 = fs.getNode('K2').mat()
    D2 = fs.getNode('D2').mat()
    R = fs.getNode('R').mat()
    T = fs.getNode('T').mat()
    fs.release()

    image_size = (w, h)

    # 读取第一对图像
    imagelist = parse_image_list(XML_PATH)
    left0 = cv2.imread(os.path.join(DATA_DIR, imagelist[0]))
    right0 = cv2.imread(os.path.join(DATA_DIR, imagelist[1]))

    alphas = [-1.0, 0.0, 0.5, 1.0]
    flag_configs = [
        (0, 'NO ZERO_DISPARITY'),
        (cv2.CALIB_ZERO_DISPARITY, 'ZERO_DISPARITY'),
    ]

    cell_h = h + 35          # 图像 + 文字条
    cell_w = w * 2           # 左右拼接

    matrix = np.zeros((len(flag_configs) * cell_h, len(alphas) * cell_w, 3), dtype=np.uint8)

    for row, (flag, flag_label) in enumerate(flag_configs):
        for col, alpha in enumerate(alphas):
            R1, R2, P1, P2, Q, roi1, roi2 = cv2.stereoRectify(
                K1, D1, K2, D2, image_size, R, T,
                alpha=alpha,
                flags=flag,
            )

            map1x, map1y = cv2.initUndistortRectifyMap(K1, D1, R1, P1, image_size, cv2.CV_32FC1)
            map2x, map2y = cv2.initUndistortRectifyMap(K2, D2, R2, P2, image_size, cv2.CV_32FC1)

            rect_l = cv2.remap(left0, map1x, map1y, cv2.INTER_LINEAR)
            rect_r = cv2.remap(right0, map2x, map2y, cv2.INTER_LINEAR)
            side = np.hstack((rect_l, rect_r))

            # 画水平核线
            for y in range(0, h, 40):
                cv2.line(side, (0, y), (side.shape[1], y), (0, 255, 0), 1)

            label = f'{flag_label}  alpha={alpha:.1f}'
            side = add_label(side, label)

            matrix[row * cell_h:(row + 1) * cell_h, col * cell_w:(col + 1) * cell_w] = side

            # 在控制台打印 ROI，方便对比
            print(f'{flag_label:20s} alpha={alpha:4.1f}  ROI1={roi1}  ROI2={roi2}')

    out_path = os.path.join(OUT_DIR, 'rectify_matrix.png')
    cv2.imwrite(out_path, matrix)
    print(f'\n已保存对比图: {out_path}')


if __name__ == '__main__':
    main()
