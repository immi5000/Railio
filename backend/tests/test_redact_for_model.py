"""What the model is allowed to see of a tool's output.

A tool result has two consumers with different needs: the frontend renders it,
the model reads it back as a `tool` message. Where those diverge, the model gets
the smaller view. The live case is show_figure's storage path — see the finding
in `redact_for_model`. Pure dict work, no DB and no OpenAI.
"""

from __future__ import annotations

from railio.tools import redact_for_model

FIGURE = {
    "path": "manuals/emd_gp38_2_sd38_2_locomotive_service_manual/p115-full-fig146.png",
    "caption": "Ground Relay Protection Circuit",
    "page": 115,
    "figure_label": "Fig.AR10-13",
    "callouts": [],
}
OUTPUT = {"ok": True, "chunk_id": 42, "figure": FIGURE}


class TestShowFigure:
    def test_the_path_is_withheld(self):
        assert "path" not in redact_for_model("show_figure", OUTPUT)["figure"]

    def test_everything_else_survives(self):
        figure = redact_for_model("show_figure", OUTPUT)["figure"]
        assert figure == {k: v for k, v in FIGURE.items() if k != "path"}

    def test_the_model_still_learns_the_call_succeeded(self):
        """Redaction must not read as a failure — the model would retry."""
        redacted = redact_for_model("show_figure", OUTPUT)
        assert redacted["ok"] is True
        assert redacted["chunk_id"] == 42

    def test_the_caller_s_output_is_not_mutated(self):
        """The same dict is emitted and persisted for the UI, which needs the path."""
        redact_for_model("show_figure", OUTPUT)
        assert OUTPUT["figure"]["path"] == FIGURE["path"]

    def test_a_failed_call_passes_through(self):
        failed = {"ok": False, "error": "chunk not found"}
        assert redact_for_model("show_figure", failed) == failed


class TestOtherTools:
    def test_search_corpus_is_untouched(self):
        """search_corpus withholds paths at the source, so there is nothing to strip."""
        output = {"chunks": [{"id": 1, "figures": [{"index": 0, "caption": "x"}]}]}
        assert redact_for_model("search_corpus", output) == output

    def test_an_unknown_tool_passes_through(self):
        output = {"ok": True, "anything": [1, 2]}
        assert redact_for_model("whatever", output) == output
