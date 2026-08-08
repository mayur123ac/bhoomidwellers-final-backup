// OTPInput — typing, backspace, paste, autofocus, navigation, and the
// focus-loss regression that made the whole thing feel dead.
//
// The component is controlled, so every test wraps it in a small host that owns
// the string. Testing it with a fixed `value` prop would pass while the real
// thing was broken — the bug was never in one render, it was in what happened
// across renders.

import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal, OTPInput, ToastProvider } from "./ui";

/* ── Harness ──────────────────────────────────────────────────────────────── */

function Host({
  initial = "",
  autoFocus = true,
  disabled = false,
  onComplete,
}: {
  initial?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onComplete?: (code: string) => void;
}) {
  const [otp, setOtp] = useState(initial);
  return (
    <>
      <OTPInput
        value={otp}
        onChange={setOtp}
        autoFocus={autoFocus}
        disabled={disabled}
        onComplete={onComplete}
      />
      <output data-testid="value">{otp}</output>
    </>
  );
}

const boxes = () => screen.getAllByRole("textbox") as HTMLInputElement[];
const box = (i: number) => screen.getByTestId(`otp-${i}`) as HTMLInputElement;
const currentValue = () => screen.getByTestId("value").textContent;

/** requestAnimationFrame-deferred focus has to settle before asserting. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/* ── Structure ────────────────────────────────────────────────────────────── */

describe("OTPInput — structure and attributes", () => {
  it("renders six real, editable text inputs", () => {
    render(<Host autoFocus={false} />);
    const inputs = boxes();
    expect(inputs).toHaveLength(6);
    for (const input of inputs) {
      expect(input.tagName).toBe("INPUT");
      expect(input).not.toBeDisabled();
      expect(input).not.toHaveAttribute("readonly");
      expect(input.maxLength).toBe(1);
    }
  });

  it("carries the mobile numeric-keyboard attributes", () => {
    render(<Host autoFocus={false} />);
    for (const input of boxes()) {
      expect(input).toHaveAttribute("inputmode", "numeric");
      expect(input).toHaveAttribute("pattern", "[0-9]*");
    }
    // Only the first advertises one-time-code; on all six, iOS offers to
    // autofill each box with the entire code.
    expect(box(0)).toHaveAttribute("autocomplete", "one-time-code");
    expect(box(1)).toHaveAttribute("autocomplete", "off");
  });

  it("respects the disabled prop and nothing else disables it", () => {
    render(<Host disabled />);
    for (const input of boxes()) expect(input).toBeDisabled();
  });
});

/* ── Focus ────────────────────────────────────────────────────────────────── */

describe("OTPInput — focus", () => {
  it("autofocuses the first box on mount", async () => {
    render(<Host />);
    await settle();
    expect(document.activeElement).toBe(box(0));
  });

  it("does not autofocus when asked not to", async () => {
    render(<Host autoFocus={false} />);
    await settle();
    expect(document.activeElement).not.toBe(box(0));
  });

  it("clicking a box places the caret in it", async () => {
    const user = userEvent.setup();
    render(<Host initial="123456" autoFocus={false} />);
    await user.click(box(3));
    expect(document.activeElement).toBe(box(3));
  });

  it("clicking past the last filled box lands on the first empty one", async () => {
    const user = userEvent.setup();
    // Two digits entered, so box 2 is the first empty; clicking box 5 must not
    // leave a gap that the value cannot represent.
    render(<Host initial="12" autoFocus={false} />);
    await user.click(box(5));
    await settle();
    expect(document.activeElement).toBe(box(2));
  });
});

/* ── Typing ───────────────────────────────────────────────────────────────── */

describe("OTPInput — typing", () => {
  it("fills the current box and advances", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await settle();

    await user.keyboard("4");
    await settle();
    expect(box(0)).toHaveValue("4");
    expect(document.activeElement).toBe(box(1));

    await user.keyboard("2");
    await settle();
    expect(box(1)).toHaveValue("2");
    expect(document.activeElement).toBe(box(2));
  });

  it("types a full six-digit code without losing focus", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await settle();

    await user.keyboard("428170");
    await settle();

    expect(currentValue()).toBe("428170");
    expect(boxes().map((b) => b.value).join("")).toBe("428170");
  });

  it("rejects non-numeric characters", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await settle();

    await user.keyboard("a1b2c3");
    await settle();

    expect(currentValue()).toBe("123");
  });

  it("never holds more than one digit per box", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await settle();
    await user.keyboard("428170");
    await settle();
    for (const input of boxes()) expect(input.value.length).toBeLessThanOrEqual(1);
  });

  it("ignores input beyond six digits", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await settle();
    await user.keyboard("1234567890");
    await settle();
    expect(currentValue()).toBe("123456");
  });

  it("typing over a filled box replaces the digit", async () => {
    const user = userEvent.setup();
    render(<Host initial="428170" autoFocus={false} />);
    await user.click(box(2));
    await user.keyboard("9");
    await settle();
    expect(currentValue()).toBe("429170");
  });

  it("fires onComplete once the sixth digit lands", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Host onComplete={onComplete} />);
    await settle();

    await user.keyboard("12345");
    await settle();
    expect(onComplete).not.toHaveBeenCalled();

    await user.keyboard("6");
    await settle();
    expect(onComplete).toHaveBeenCalledWith("123456");
  });
});

/* ── Backspace ────────────────────────────────────────────────────────────── */

describe("OTPInput — backspace and delete", () => {
  it("clears the current digit when the box has one", async () => {
    const user = userEvent.setup();
    render(<Host initial="428170" autoFocus={false} />);
    await user.click(box(3));
    await user.keyboard("{Backspace}");
    await settle();

    expect(box(3)).toHaveValue("");
    expect(document.activeElement).toBe(box(3));
  });

  it("steps back and clears when the box is already empty", async () => {
    const user = userEvent.setup();
    render(<Host initial="42" autoFocus={false} />);
    await user.click(box(2)); // first empty
    await user.keyboard("{Backspace}");
    await settle();

    expect(currentValue()).toBe("4");
    expect(document.activeElement).toBe(box(1));
  });

  it("does nothing at the first box when empty", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await settle();
    await user.keyboard("{Backspace}");
    await settle();
    expect(currentValue()).toBe("");
    expect(document.activeElement).toBe(box(0));
  });

  it("backspaces the whole code away", async () => {
    const user = userEvent.setup();
    render(<Host initial="428170" autoFocus={false} />);
    await user.click(box(5));
    for (let i = 0; i < 6; i++) {
      await user.keyboard("{Backspace}");
      await settle();
    }
    expect(currentValue()).toBe("");
  });
});

/* ── Navigation ───────────────────────────────────────────────────────────── */

describe("OTPInput — keyboard navigation", () => {
  it("moves left and right with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Host initial="428170" autoFocus={false} />);
    await user.click(box(3));

    await user.keyboard("{ArrowLeft}");
    await settle();
    expect(document.activeElement).toBe(box(2));

    await user.keyboard("{ArrowRight}");
    await settle();
    expect(document.activeElement).toBe(box(3));
  });

  it("clamps at both ends", async () => {
    const user = userEvent.setup();
    render(<Host initial="428170" autoFocus={false} />);

    await user.click(box(0));
    await user.keyboard("{ArrowLeft}");
    await settle();
    expect(document.activeElement).toBe(box(0));

    await user.click(box(5));
    await user.keyboard("{ArrowRight}");
    await settle();
    expect(document.activeElement).toBe(box(5));
  });

  it("Home and End jump to the ends", async () => {
    const user = userEvent.setup();
    render(<Host initial="428170" autoFocus={false} />);
    await user.click(box(3));

    await user.keyboard("{Home}");
    await settle();
    expect(document.activeElement).toBe(box(0));

    await user.keyboard("{End}");
    await settle();
    expect(document.activeElement).toBe(box(5));
  });
});

/* ── Paste ────────────────────────────────────────────────────────────────── */

describe("OTPInput — paste", () => {
  it("distributes a six-digit paste across all boxes", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await settle();

    await user.paste("428170");
    await settle();

    expect(currentValue()).toBe("428170");
    expect(boxes().map((b) => b.value).join("")).toBe("428170");
  });

  it("strips spaces and punctuation out of a pasted code", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await settle();
    await user.paste("428 170");
    await settle();
    expect(currentValue()).toBe("428170");
  });

  it("takes only the first six digits of a longer paste", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await settle();
    await user.paste("Your code is 428170, expires in 10 minutes");
    await settle();
    // Digits in order: 428170 then 10 — the first six win.
    expect(currentValue()).toBe("428170");
  });

  it("pasting into a later box fills from there", async () => {
    const user = userEvent.setup();
    render(<Host initial="428" autoFocus={false} />);
    await user.click(box(3));
    await user.paste("999");
    await settle();
    expect(currentValue()).toBe("428999");
  });

  it("ignores a paste with no digits in it", async () => {
    const user = userEvent.setup();
    render(<Host initial="42" autoFocus={false} />);
    await user.click(box(2));
    await user.paste("no digits here");
    await settle();
    expect(currentValue()).toBe("42");
  });
});

/* ── The regression ───────────────────────────────────────────────────────── */

describe("OTPInput inside Modal — the focus-loss regression", () => {
  /**
   * Reproduces the reported bug exactly.
   *
   * The VerificationModal runs a 250ms countdown interval, so it re-rendered
   * four times a second whether or not anyone was typing. Modal's focus effect
   * listed `onClose` in its dependency array, and every caller passes an inline
   * arrow — a new identity per render — so the effect tore down and re-ran on
   * each of those renders. Its cleanup calls `previouslyFocused.focus()`, which
   * yanked the caret out of the OTP boxes several times a second.
   *
   * This host reproduces both halves: a ticking parent and an inline onClose.
   */
  function TickingModalHost() {
    const [, setTick] = useState(0);
    const [otp, setOtp] = useState("");

    // The countdown, standing in for useCountdowns. In an effect with a
    // cleanup, not a useState initialiser — an uncleared interval keeps firing
    // after the test tears the DOM down, and setState on an unmounted tree
    // throws "window is not defined" from React's scheduler.
    useEffect(() => {
      const id = setInterval(() => setTick((t) => t + 1), 20);
      return () => clearInterval(id);
    }, []);

    return (
      <ToastProvider>
        <button type="button">opener</button>
        <Modal open onClose={() => setOtp("")} title="Enter Verification Code">
          <OTPInput value={otp} onChange={setOtp} />
          <output data-testid="value">{otp}</output>
        </Modal>
      </ToastProvider>
    );
  }

  it("keeps focus in the boxes while the parent re-renders on a timer", async () => {
    const user = userEvent.setup();
    render(<TickingModalHost />);

    // Let the modal's 30ms focus timer run and several ticks elapse.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    expect(document.activeElement).toBe(box(0));

    await user.keyboard("4");
    await settle();
    expect(box(0)).toHaveValue("4");

    // The critical assertion: after more re-render ticks, focus must still be
    // inside the component. Before the fix it had been dragged back to the
    // opener button.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(boxes()).toContain(document.activeElement);
  });

  it("accepts a whole code typed through the re-render churn", async () => {
    const user = userEvent.setup();
    render(<TickingModalHost />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    // A digit, then a pause long enough for several countdown ticks, repeated —
    // which is what a person typing at human speed actually does.
    for (const digit of "428170") {
      await user.keyboard(digit);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
    }

    expect(screen.getByTestId("value").textContent).toBe("428170");
  });

  it("puts the caret in the first OTP box, not the first focusable element", async () => {
    // The real dialog has a "Back" button and other controls in the DOM. The
    // caret must land on the code entry, which is what data-autofocus marks.
    render(
      <ToastProvider>
        <Modal open onClose={() => {}} title="Enter Verification Code">
          <button type="button">Change email</button>
          <OTPInput value="" onChange={() => {}} autoFocus={false} />
        </Modal>
      </ToastProvider>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(document.activeElement).toBe(box(0));
  });
});

/* ── Value contract ───────────────────────────────────────────────────────── */

describe("OTPInput — value contract", () => {
  it("never produces a value containing spaces", async () => {
    const user = userEvent.setup();
    render(<Host initial="42" autoFocus={false} />);
    // The old implementation padded gaps with spaces, so clicking a later box
    // and typing produced "42 9" — submitted to the server verbatim, and
    // length-4 while looking like it had four digits.
    await user.click(box(5));
    await user.keyboard("9");
    await settle();

    const value = currentValue() ?? "";
    expect(value).not.toMatch(/\s/);
    expect(value).toBe("429");
  });

  it("reports length 6 only when six digits are present", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await settle();

    await user.keyboard("4281");
    await settle();
    expect((currentValue() ?? "").length).toBe(4);

    await user.keyboard("70");
    await settle();
    expect((currentValue() ?? "").length).toBe(6);
  });

  it("sanitises a non-numeric seeded value", () => {
    render(<Host initial="4a2b81x" autoFocus={false} />);
    expect(boxes().map((b) => b.value).join("")).toBe("4281");
  });
});
