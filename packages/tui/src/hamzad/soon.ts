/**
 * Asking the CLI's own server again after a refusal. The first questions an interface asks can
 * reach the server before it has set up the folder they are about, and are refused; waiting for
 * the next event or the next minute would leave the credits and the sign-in state blank for that
 * long. So a refused question is asked again after 1, 2, 4, 8 and 16 seconds, and then left to
 * the usual events and timers.
 */
export function askAgainSoon() {
  const state = { tries: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined }
  return {
    /** Call when an answer came: the next refusal starts from one second again. */
    answered() {
      state.tries = 0
      clearTimeout(state.timer)
    },
    /** Call when the question was refused; `ask` runs again after the next wait, if any is left. */
    refused(ask: () => void) {
      if (state.tries >= 5) return
      clearTimeout(state.timer)
      state.timer = setTimeout(ask, 1000 * 2 ** state.tries)
      state.tries += 1
    },
    stop() {
      clearTimeout(state.timer)
    },
  }
}
