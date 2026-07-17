import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchableSelect } from "@/components/SearchableSelect";

const OPTIONS = ["MAIN-A1", "YARD-B2", "REMOTE-MAIN", "SHOP-C3"];

function setup(value = "") {
  const onChange = vi.fn();
  const utils = render(
    <SearchableSelect value={value} onChange={onChange} options={OPTIONS} placeholder="Location" />,
  );
  return {
    onChange,
    user: userEvent.setup(),
    input: screen.getByPlaceholderText("Location") as HTMLInputElement,
    ...utils,
  };
}

const optionTexts = () =>
  Array.from(document.querySelectorAll(".combo-opt")).map((n) => n.textContent);

describe("SearchableSelect", () => {
  it("shows the committed value while closed", () => {
    const { input } = setup("YARD-B2");
    expect(input.value).toBe("YARD-B2");
  });

  it("clears the field to a blank draft on focus, so typing filters from scratch", async () => {
    const { input, user } = setup("YARD-B2");
    await user.click(input);
    expect(input.value).toBe("");
    expect(optionTexts()).toEqual(OPTIONS);
  });

  describe("ranking", () => {
    it("puts prefix matches before substring matches", async () => {
      const { input, user } = setup();
      await user.click(input);
      await user.type(input, "main");
      // MAIN-A1 starts with it; REMOTE-MAIN only contains it.
      expect(optionTexts()).toEqual(["MAIN-A1", "REMOTE-MAIN"]);
    });

    it("matches case-insensitively", async () => {
      const { input, user } = setup();
      await user.click(input);
      await user.type(input, "YaRd");
      expect(optionTexts()).toEqual(["YARD-B2"]);
    });

    it("says so when nothing matches", async () => {
      const { input, user } = setup();
      await user.click(input);
      await user.type(input, "zzzz");
      expect(screen.getByText("No matches")).toBeInTheDocument();
    });
  });

  describe("committing", () => {
    // onPointerDown, not onClick: the outside-pointerdown handler would
    // otherwise close the menu before a click could land.
    it("commits on pointerdown", async () => {
      const { input, user, onChange } = setup();
      await user.click(input);
      await user.click(screen.getByText("SHOP-C3"));
      expect(onChange).toHaveBeenCalledWith("SHOP-C3");
    });

    it("commits the active option on Enter", async () => {
      const { input, user, onChange } = setup();
      await user.click(input);
      await user.keyboard("{ArrowDown}{Enter}");
      expect(onChange).toHaveBeenCalledWith(OPTIONS[1]);
    });

    it("only ever commits a real option, never the typed draft", async () => {
      const { input, user, onChange } = setup();
      await user.click(input);
      await user.type(input, "mai");
      await user.keyboard("{Enter}");
      expect(onChange).toHaveBeenCalledWith("MAIN-A1");
      expect(onChange).not.toHaveBeenCalledWith("mai");
    });

    it("commits nothing on Enter when there are no matches", async () => {
      const { input, user, onChange } = setup();
      await user.click(input);
      await user.type(input, "zzzz{Enter}");
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("keyboard navigation", () => {
    it("clamps at the end of the list", async () => {
      const { input, user, onChange } = setup();
      await user.click(input);
      await user.keyboard("{ArrowDown}".repeat(20));
      await user.keyboard("{Enter}");
      expect(onChange).toHaveBeenCalledWith(OPTIONS[OPTIONS.length - 1]);
    });

    it("clamps at the start of the list", async () => {
      const { input, user, onChange } = setup();
      await user.click(input);
      await user.keyboard("{ArrowUp}".repeat(5));
      await user.keyboard("{Enter}");
      expect(onChange).toHaveBeenCalledWith(OPTIONS[0]);
    });

    it("closes on Escape without committing", async () => {
      const { input, user, onChange } = setup("YARD-B2");
      await user.click(input);
      await user.keyboard("{Escape}");
      expect(document.querySelector(".combo-menu")).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      expect(input.value).toBe("YARD-B2");
    });
  });

  describe("clear button", () => {
    it("appears only when there's a value and the menu is closed", async () => {
      setup("YARD-B2");
      expect(screen.getByLabelText("Clear filter")).toBeInTheDocument();
    });

    it("is absent when there's no value", () => {
      setup("");
      expect(screen.queryByLabelText("Clear filter")).toBeNull();
    });

    it("is absent while the menu is open", async () => {
      const { input, user } = setup("YARD-B2");
      await user.click(input);
      expect(screen.queryByLabelText("Clear filter")).toBeNull();
    });

    it("clears to the empty string, meaning no filter", async () => {
      const { user, onChange } = setup("YARD-B2");
      await user.click(screen.getByLabelText("Clear filter"));
      expect(onChange).toHaveBeenCalledWith("");
    });
  });

  it("closes when the pointer goes down outside it", async () => {
    const { input, user } = setup();
    await user.click(input);
    expect(document.querySelector(".combo-menu")).not.toBeNull();
    await user.click(document.body);
    expect(document.querySelector(".combo-menu")).toBeNull();
  });
});
