#!/usr/bin/env python3
"""Generate Chinese narration locally with Qwen3-TTS on Apple Silicon."""

from __future__ import annotations

import argparse
from pathlib import Path

import mlx.core as mx
import soundfile as sf
from mlx_audio.tts.utils import load_model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("text_file", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", required=True)
    parser.add_argument("--style", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--seed", required=True, type=int)
    parser.add_argument("--temperature", required=True, type=float)
    parser.add_argument("--top-k", required=True, type=int)
    parser.add_argument("--top-p", required=True, type=float)
    parser.add_argument("--repetition-penalty", required=True, type=float)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    text = args.text_file.read_text(encoding="utf-8").strip()
    if not text:
        raise SystemExit("旁白文案不能为空")

    mx.random.seed(args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    model = load_model(args.model)
    results = list(
        model.generate_voice_design(
            text=text,
            language=args.language,
            instruct=args.style,
            temperature=args.temperature,
            top_k=args.top_k,
            top_p=args.top_p,
            repetition_penalty=args.repetition_penalty,
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
