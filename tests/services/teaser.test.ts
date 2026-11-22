import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createTeaserScheduler } from "../../src/services/teaser";

describe("createTeaserScheduler", () => {
  let visible: boolean;
  let chatOpen: boolean;

  const create = () =>
    createTeaserScheduler({
      delayMs: 800,
      visibleMs: 10000,
      setVisible: (value) => {
        visible = value;
      },
      canShow: () => !chatOpen,
    });

  beforeEach(() => {
    jest.useFakeTimers();
    visible = false;
    chatOpen = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows the teaser after the delay and hides it after the visible time", () => {
    create().schedule();

    jest.advanceTimersByTime(799);
    expect(visible).toBe(false);
    jest.advanceTimersByTime(1);
    expect(visible).toBe(true);
    jest.advanceTimersByTime(10000);
    expect(visible).toBe(false);
  });

  it("does not show the teaser when the chat was opened before the delay elapsed", () => {
    create().schedule();
    chatOpen = true;

    jest.advanceTimersByTime(800);

    expect(visible).toBe(false);
  });

  it("cancels the pending show and the hide timer when hidden explicitly", () => {
    const scheduler = create();
    scheduler.schedule();
    scheduler.hide();
    jest.advanceTimersByTime(800);
    expect(visible).toBe(false);

    const second = create();
    second.schedule();
    jest.advanceTimersByTime(800);
    expect(visible).toBe(true);
    second.hide();
    expect(visible).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("schedules only once", () => {
    const scheduler = create();
    scheduler.schedule();
    scheduler.schedule();

    expect(jest.getTimerCount()).toBe(1);
  });

  it("dispose clears timers without changing visibility", () => {
    const scheduler = create();
    scheduler.schedule();
    jest.advanceTimersByTime(800);
    scheduler.dispose();

    expect(visible).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
