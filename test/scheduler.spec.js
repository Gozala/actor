import { Task } from "../src/lib.js"
import { assert, inspect, createLog } from "./util.js"

describe("Scheduler", () => {
  it("throws when current is called outside of a task", () => {
    assert.throws(() => Task.current(), /must be called from the running task/)
  })
})
