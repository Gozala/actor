import { Effect, Task } from "../src/lib.js"
import { assert, inspect, createLog } from "./util.js"

describe("Task.listen", () => {
  it("can listen to several fx", async () => {
    /**
     * @param {number} delay
     * @param {number} count
     */
    function* source(delay, count) {
      let start = Date.now()
      let n = 0
      while (n < count) {
        yield* Task.send(n)
        n++
        yield* Task.sleep(delay)
      }
    }

    const fx = Effect.listen({
      beep: source(3, 5),
      bop: source(5, 3),
      buz: source(2, 2),
    })

    const { mail, ...result } = await Task.fork(inspect(fx))
    assert.deepEqual(result, { ok: true, value: undefined })
    const inbox = mail.map(m => JSON.stringify(m))

    const expect = [
      { beep: 0 },
      { beep: 1 },
      { beep: 2 },
      { beep: 3 },
      { beep: 4 },
      { bop: 0 },
      { bop: 1 },
      { bop: 2 },
      { buz: 0 },
      { buz: 1 },
    ]

    assert.notDeepEqual(
      [...inbox].sort(),
      inbox,
      "messages aren not ordered by actors"
    )
    assert.deepEqual(
      [...inbox].sort(),
      [...expect.map(v => JSON.stringify(v))].sort(),
      "all messages were received"
    )
  })

  it("can listen to none", async () => {
    assert.deepEqual(await Task.fork(inspect(Effect.listen({}))), {
      ok: true,
      value: undefined,
      mail: [],
    })
  })

  it("can produces no messages on empty tasks", async () => {
    const { log, output } = createLog()
    function* work() {
      log("start work")
      yield* Task.sleep(2)
      log("end work")
    }
    const main = Effect.listen({
      none: work(),
    })

    assert.deepEqual(await Task.fork(inspect(main)), {
      ok: true,
      value: undefined,
      mail: [],
    })
  })

  it("can turn task into effect", async () => {
    function* work() {
      Task.sleep(1)
      return "hi"
    }

    const fx = Effect.perform(work())

    assert.deepEqual(await Task.fork(inspect(fx)), {
      ok: true,
      value: undefined,
      mail: ["hi"],
    })
  })

  it("can turn multiple tasks into effect", async () => {
    function* fx(msg = "", delay = 1) {
      yield* Task.sleep(delay)
      return msg
    }

    const effect = Effect.batch([
      Effect.perform(fx("foo", 5)),
      Effect.perform(fx("bar", 1)),
      Effect.perform(fx("baz", 2)),
    ])

    assert.deepEqual(await Task.fork(inspect(effect)), {
      ok: true,
      value: undefined,
      mail: ["bar", "baz", "foo"],
    })
  })

  it("can turn 0 tasks into effect", async () => {
    const effect = Effect.batch([])
    assert.deepEqual(await Task.fork(inspect(effect)), {
      ok: true,
      value: undefined,
      mail: [],
    })
  })

  it("can batch multiple effects", async () => {
    function* fx(msg = "", delay = 1) {
      yield* Task.sleep(delay)
      yield* Task.send(msg)
    }

    const effect = Effect.batch([fx("foo", 5), fx("bar", 1), fx("baz", 2)])
    assert.deepEqual(await Task.fork(inspect(effect)), {
      ok: true,
      value: undefined,
      mail: ["bar", "baz", "foo"],
    })
  })
})
