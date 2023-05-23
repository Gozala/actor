import { Task, Effect } from "../src/lib.js"
import { assert, createLog, inspect } from "./util.js"

describe("Task.loop", () => {
  it("can loop", async () => {
    const { log, output } = createLog()
    function* step({ n } = { n: 0 }) {
      log(`<< ${n}`)
      while (--n > 0) {
        log(`>> ${n}`)
        yield* Task.sleep(n)
        yield* Task.send({ n })
      }
    }

    await Task.fork(Task.loop(step({ n: 4 }), step))

    assert.notDeepEqual([...output].sort(), output)
    assert.deepEqual(
      [...output].sort(),
      [
        "<< 4",
        ">> 3",
        ">> 2",
        ">> 1",
        "<< 3",
        ">> 2",
        ">> 1",
        "<< 2",
        ">> 1",
        "<< 1",
        "<< 2",
        ">> 1",
        "<< 1",
        "<< 1",
        "<< 1",
      ].sort()
    )
  })

  it("can wait in a loop", async () => {
    const { log, output } = createLog()
    const main = Task.loop(Task.send("start"), function* (message) {
      log(`<< ${message}`)
      const result = yield* Task.wait(0)
      log(`>> ${result}`)
    })

    assert.deepEqual(await Task.fork(main), {})
    assert.deepEqual(output, ["<< start", ">> 0"])
  })

  it("error stops the loop", async () => {
    const { log, output } = createLog()
    const crash = new Error("crash")

    const crasher = function* () {
      log("start crasher")
      yield* Task.sleep(0)
      throw crash
    }

    const runner = function* () {
      try {
        log("start runner")
        for (const n of Array(7).keys()) {
          yield* Task.sleep(0)
          log(`ran ${n}`)
        }
      } finally {
        log("cleanup runner")
      }
    }

    const main = function* () {
      log("start main")
      yield* Task.send({ spawn: runner })
      yield* Task.send({ spawn: crasher })
    }

    const result = await Task.fork(
      inspect(Task.loop(main(), ({ spawn }) => spawn()))
    )

    assert.deepEqual(result, {
      ok: false,
      error: crash,
      mail: [{ spawn: runner }, { spawn: crasher }],
    })

    assert.deepEqual(output, [
      "start main",
      "start runner",
      "start crasher",
      "ran 0",
      "cleanup runner",
    ])
  })
})
