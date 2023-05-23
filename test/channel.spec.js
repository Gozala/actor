import * as Task from "../src/lib.js"
import * as Channel from "../src/channel.js"
import { assert, createLog, inspect } from "./util.js"

describe("Channel", () => {
  it("throws when putting to closed channel", async () => {
    const channel = Channel.open()
    channel.close()
    assert.throws(() => channel.put(1), /Channel is closed/)
  })

  it("reads undefined if channel is closed", async () => {
    Task.spawn(function* () {
      const channel = Channel.open()
      channel.put(1)
      const first = yield* channel.take()
      assert.equal(first, 1)
      const second = Task.fork(channel.take())
      yield
      channel.close()
      assert.equal(yield* second.join(), undefined)
    })
  })
})
