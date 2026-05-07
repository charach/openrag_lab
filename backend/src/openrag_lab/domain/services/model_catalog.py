"""In-process catalog of downloadable models the app may pull on first use.

Only the embedders shipped with the three default presets are listed
today; LLMs are external (API-key auth) and don't need a license gate.
The license bodies are short enough to ship in-process so the modal
renders without a network round-trip.
"""

from __future__ import annotations

from openrag_lab.domain.models.model_card import ModelCard

_APACHE_2_0_BODY = (
    "Apache License 2.0\n"
    "\n"
    "Licensed under the Apache License, Version 2.0 (the \"License\"); you may\n"
    "not use this file except in compliance with the License. You may obtain a\n"
    "copy of the License at https://www.apache.org/licenses/LICENSE-2.0.\n"
    "\n"
    "Unless required by applicable law or agreed to in writing, software\n"
    "distributed under the License is distributed on an \"AS IS\" BASIS, WITHOUT\n"
    "WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the\n"
    "License for the specific language governing permissions and limitations\n"
    "under the License."
)

_MIT_BODY = (
    "MIT License\n"
    "\n"
    "Permission is hereby granted, free of charge, to any person obtaining a\n"
    "copy of this software and associated documentation files (the \"Software\"),\n"
    "to deal in the Software without restriction, including without limitation\n"
    "the rights to use, copy, modify, merge, publish, distribute, sublicense,\n"
    "and/or sell copies of the Software, and to permit persons to whom the\n"
    "Software is furnished to do so, subject to the following conditions:\n"
    "\n"
    "The above copyright notice and this permission notice shall be included\n"
    "in all copies or substantial portions of the Software.\n"
    "\n"
    "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND."
)

LICENSE_BODIES: dict[str, str] = {
    "Apache-2.0": _APACHE_2_0_BODY,
    "MIT": _MIT_BODY,
}


_CATALOG: dict[str, ModelCard] = {
    "all-MiniLM-L6-v2": ModelCard(
        id="all-MiniLM-L6-v2",
        kind="embedder",
        display_name="MiniLM-L6 (lite)",
        license_id="Apache-2.0",
        license_url="https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2",
        size_estimate_bytes=90 * 1024 * 1024,
        commercial_use="yes",
    ),
    "BAAI/bge-base-en-v1.5": ModelCard(
        id="BAAI/bge-base-en-v1.5",
        kind="embedder",
        display_name="BGE base EN v1.5 (balanced)",
        license_id="MIT",
        license_url="https://huggingface.co/BAAI/bge-base-en-v1.5",
        size_estimate_bytes=440 * 1024 * 1024,
        commercial_use="yes",
    ),
    "BAAI/bge-m3": ModelCard(
        id="BAAI/bge-m3",
        kind="embedder",
        display_name="BGE-M3 (accuracy)",
        license_id="MIT",
        license_url="https://huggingface.co/BAAI/bge-m3",
        size_estimate_bytes=2_270 * 1024 * 1024,
        commercial_use="yes",
    ),
}


def get_card(model_id: str) -> ModelCard | None:
    return _CATALOG.get(model_id)


def list_cards() -> list[ModelCard]:
    return list(_CATALOG.values())


def license_body(license_id: str) -> str | None:
    return LICENSE_BODIES.get(license_id)
