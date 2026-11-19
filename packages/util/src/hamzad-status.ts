export * as HamzadStatus from "./hamzad-status.js"

// What Hamzad's API says about itself, in words for a person. The server, the command line and the
// interface each meet the same states, so the states and their sentences are kept in one place.

import { Brand } from "./brand.js"

/**
 * Why the gateway lists models for this person, or does not:
 * - `listed`: it does.
 * - `sign-in`: it asks for a key, and none was sent (it is not yet open to everyone).
 * - `refused`: it did not accept the key that was sent.
 * - `no-access`: it is on, but not for this account yet.
 * - `unavailable`: it is switched off.
 * - `unreachable`: no answer.
 */
export const states = ["listed", "sign-in", "refused", "no-access", "unavailable", "unreachable"] as const
export type State = (typeof states)[number]

export const unavailable = "Hamzad's API for tools is not available yet."
export const noAccess = "This account does not have access to Hamzad's API yet."
export const signedOut = `You are not signed in to Hamzad. Run \`${Brand.cli} auth login\` and approve this device in your panel.`
export const refused = `Hamzad did not accept this sign-in. Run \`${Brand.cli} auth login\` to sign in again.`
export const unreachable = "Could not reach Hamzad. Check your connection and try again."

/** One line for a person looking at an empty model list; nothing when the list is there. */
export function reason(state: State) {
  switch (state) {
    case "listed":
      return undefined
    case "sign-in":
      return `Sign in to see Hamzad's models: run \`${Brand.cli} auth login\`.`
    case "refused":
      return refused
    case "no-access":
      return noAccess
    case "unavailable":
      return unavailable
    case "unreachable":
      return unreachable
  }
}

/** One line for a prompt that has no model to go to, for the same reasons. */
export const prompt = (state: State) => (state === "sign-in" ? signedOut : reason(state))

/**
 * One line for a person asking what their account has left and used, when there is no answer to
 * show: nobody is signed in, or the gateway gave none for one of the reasons above.
 */
export function account(state: State, signedIn: boolean) {
  if (!signedIn) return state === "listed" || state === "sign-in" ? signedOut : (reason(state) ?? signedOut)
  return reason(state) ?? unreachable
}

/**
 * What the sign-in by approving the device says when it cannot go on, by the code the API or the
 * panel gave. These routes answer in the API's own shape, with a Persian message meant for the
 * panel, so the words here are chosen by the code alone.
 */
export function signIn(code: string) {
  switch (code) {
    case "access_denied":
      return "The sign-in was declined in the panel."
    case "expired_token":
      return "The sign-in code expired before it was approved. Start again."
    case "auth.device_unavailable":
    // An API from before the sign-in routes existed answers as for any address it does not have.
    case "resource.not_found":
      return unavailable
    case "auth.device_attempts":
      return "Too many sign-in attempts. Try again in a little while."
    case "keys.too_many":
      return "This account already has as many keys as it may. Revoke one in the Hamzad panel, then sign in again."
    case "unreachable":
      return "Could not reach Hamzad to sign in. Check your connection and try again."
    default:
      return "Hamzad could not complete the sign-in. Try again in a little while."
  }
}

/**
 * How the command line and the interface ask the server which state it is in. Plain JSON Schema,
 * so the three packages share it without depending on one another.
 */
export const definition = {
  id: "hamzad.status",
  methods: {
    get: {
      input: { type: "object" },
      output: {
        type: "object",
        properties: { models: { type: "string", enum: [...states] } },
        required: ["models"],
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { models: { type: "string", enum: [...states] } },
        required: ["models"],
      },
    },
  },
} as const

/** The state in the server's answer, when it is one this build knows. */
export function read(answer: unknown): State | undefined {
  if (typeof answer !== "object" || answer === null || !("models" in answer)) return undefined
  return states.find((state) => state === answer.models)
}
