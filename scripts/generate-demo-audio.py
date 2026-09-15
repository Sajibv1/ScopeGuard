#!/usr/bin/env python3
"""
Generate audio narration for DEMO-SCRIPT.md using OpenAI TTS-1-HD.

Usage:
    python3 scripts/generate-demo-audio.py [--voice onyx|echo|alloy|nova|fable|shimmer] [--output path/to/output.mp3]
"""

import os
import sys
import json
import urllib.request
import argparse

DEMO_SCRIPT_TEXT = """Every freelancer knows this email: "one more small thing before we launch."

It's never small, and answering it well means digging through a statement of work you half-remember. Existing tools either don't know the contract exists — or they're AI contract review that will happily make the legal and financial judgment for you.

ScopeGuard is built around a different idea: the machine reads, quotes, and remembers. The human decides, prices, and sends.

This is a real statement of work for a fictional bakery, and a real client message asking for five things at once: online ordering, customer accounts, a new hero image, a Portuguese version, and separate pages per location.

For every item in the client's request, ScopeGuard quotes the exact sentence in the agreement — highlighted where it lives in the document.

This quote isn't decorative: it's verified character-by-character against the source. If the model had invented this sentence, it would have been rejected, not displayed.

And here's the important one: when the document doesn't settle the question, the label is downgraded to "needs clarification." ScopeGuard never treats absence from the contract as exclusion.

Notice what's missing everywhere: numbers. Hours, prices, dates — the model can't supply them. The schema has no field for them. That's on purpose.

The scope says two revision rounds. The client asks for a change. Does ScopeGuard know how many rounds are spent? No — and it doesn't pretend to. It asks. That single judgment is the difference between a tool and a liability.

I confirm or override every label — my decision is stored as my decision, separate from the model's output. Re-running the analysis can never touch my review. The hours are mine: the totals are computed from my numbers, and the same formula renders the screen, the reply, and the PDF.

Watch what happens when I try to finalize with unpriced work.

Blocked.

A draft can carry open questions; a final change order cannot. The AI can't invent hours, so it can't let me send a blank check either. This refusal is the product.

Finalizing freezes the document as a snapshot — and because I connected my own Slack workspace with OAuth, the notification goes to my channel through my connection, with the token stored encrypted and visible only to me.

Two things it will never do: contact my client — that's my email to send, and the "Open in Gmail" button drafts it in my own compose window — and change a figure or a status. Notifications announce; they don't act.

Everything you saw runs with row-level security on every table — there's no admin key in this codebase, not even for the public demo. The whole workflow runs offline in fixture mode, verified by 107 tests and an eval suite whose headline metric isn't accuracy — it's the count of claims made without evidence.

ScopeGuard: evidence-backed change orders, where the machine reads and the human decides."""


def get_api_key():
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        return api_key

    # Check .env.local
    env_file = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                if line.startswith("OPENAI_API_KEY="):
                    return line.strip().split("=", 1)[1].strip("\"' ")

    raise ValueError("OPENAI_API_KEY not found in environment or .env.local")


def generate_audio(output_path, voice="onyx", model="tts-1-hd"):
    api_key = get_api_key()
    print(f"Generating audio with voice='{voice}', model='{model}'...")

    req = urllib.request.Request(
        "https://api.openai.com/v1/audio/speech",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        data=json.dumps({
            "model": model,
            "input": DEMO_SCRIPT_TEXT,
            "voice": voice,
        }).encode("utf-8"),
    )

    with urllib.request.urlopen(req, timeout=90) as resp:
        audio_data = resp.read()

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(audio_data)

    print(f"Success! Audio saved to: {output_path} ({len(audio_data):,} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate ScopeGuard demo audio")
    parser.add_argument("--voice", default="onyx", choices=["onyx", "echo", "alloy", "nova", "fable", "shimmer"], help="TTS Voice")
    parser.add_argument("--model", default="tts-1-hd", choices=["tts-1", "tts-1-hd"], help="OpenAI TTS Model")
    parser.add_argument("--output", default="demo-audio.mp3", help="Output MP3 path")
    args = parser.parse_args()

    generate_audio(args.output, voice=args.voice, model=args.model)
