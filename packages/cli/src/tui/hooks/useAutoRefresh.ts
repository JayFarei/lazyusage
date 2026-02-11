/**
 * Auto-refresh timer hook with pause/speed controls.
 */
import { createSignal, onCleanup } from "solid-js";

export function useAutoRefresh(onRefresh: () => void, initialInterval = 10) {
  const [enabled, setEnabled] = createSignal(true);
  const [interval, setIntervalValue] = createSignal(Math.max(5, initialInterval));
  let timer: ReturnType<typeof setInterval> | null = null;

  function startTimer() {
    stopTimer();
    if (enabled()) {
      timer = setInterval(onRefresh, interval() * 1000);
    }
  }

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function togglePause() {
    setEnabled(!enabled());
    if (enabled()) {
      startTimer();
    } else {
      stopTimer();
    }
  }

  function speedUp() {
    const newVal = Math.max(5, interval() - 5);
    setIntervalValue(newVal);
    if (enabled()) startTimer();
  }

  function slowDown() {
    const newVal = Math.min(60, interval() + 5);
    setIntervalValue(newVal);
    if (enabled()) startTimer();
  }

  onCleanup(stopTimer);

  return { enabled, interval, togglePause, speedUp, slowDown, startTimer };
}
