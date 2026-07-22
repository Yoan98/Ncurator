#!/usr/bin/env python3
"""Generate Chinese narration locally with Qwen3-TTS on Apple Silicon."""

from __future__ import annotations

import argparse
from pathlib import Path

import soundfile as sf
from mlx_audio.tts.utils import load_model


DEFAULT_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit"
DEFAULT_STYLE = (
    "一位四十岁左右的中国男性，声音成熟、可信、松弛，像经验丰富的产品负责人"
    "在和同事自然交流。普通话标准但没有播音腔，不要刻意压低嗓音，不要广告腔。"
    "语速自然，句子之间有真实思考感，重点词轻微强调，整体克制、从容、有温度。"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("text_file", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--style", default=DEFAULT_STYLE)
    parser.add_argument("--language", default="Chinese")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    text = args.text_file.read_text(encoding="utf-8").strip()
    if not text:
        raise SystemExit("旁白文案不能为空")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    model = load_model(args.model)
    results = list(
        model.generate_voice_design(
            text=text,
            language=args.language,
            instruct=args.style,
        )
    )
    if not results:
        raise RuntimeError("模型没有生成音频")

    audio = results[0].audio
    sample_rate = results[0].sample_rate
    sf.write(args.output, audio, sample_rate)
    print(f"已生成：{args.output}（{sample_rate} Hz）")


if __name__ == "__main__":
    main()
