import * as Task from "../src/lib.js"
import { assert, createLog, inspect } from "./util.js"

describe("subtasks", () => {
  it("crashes parent", async () => {
    /**
     * @param {Task.Await<number>} x
     * @param {Task.Await<number>} y
     */
    function* worker(x, y) {
      return (yield* Task.wait(x)) + (yield* Task.wait(y))
    }

    function* main() {
      const one = yield* worker(1, 2)
      const two = yield* worker(Promise.reject(5), one)
      return two
    }
    const result = await Task.fork(inspect(main()))

    assert.deepEqual(result, {
      ok: false,
      error: 5,
      mail: [],
    })
  })

  it("fork does not crash parent", async () => {
    const { output, log } = createLog()

    /**
     * @param {string} id
     */
    function* work(id) {
      log(`start ${id}`)
      yield* Task.send(`${id}#1`)
      yield* Task.wait(Promise.reject("boom"))
    }

    function* main() {
      Task.fork(work("A"))
      yield* Task.wait(Promise.resolve("one"))
      Task.fork(work("B"))
      return yield* Task.wait(Promise.resolve("two"))
    }

    const result = await Task.fork(inspect(main()))

    assert.deepEqual(result, {
      ok: true,
      value: "two",
      mail: [],
    })
    assert.deepEqual(output, ["start A", "start B"])
  })

  it("waiting on forks result crashes parent", async () => {
    const { output, log } = createLog()

    /**
     * @param {string} id
     */
    function* worker(id) {
      log(`Start ${id}`)
      yield* Task.send(`${id}#1`)
      yield* Task.wait(Promise.reject(`${id}!boom`))
    }

    function* main() {
      const a = Task.fork(worker("A"))
      yield* Task.wait(Promise.resolve("one"))
      // assert.deepEqual(output, ["Start A"])
      const b = Task.fork(worker("B"))
      yield* Task.send("hi")
      // assert.deepEqual(output, ["Start A", "Start B"])
      yield* Task.join([a, b])

      yield* Task.wait(Promise.resolve("two"))

      return 0
    }

    const result = await Task.fork(inspect(main()))

    assert.deepEqual(result, {
      ok: false,
      error: "A!boom",
      mail: ["hi"],
    })

    assert.deepEqual(output, ["Start A", "Start B"])
  })

  it(".join() forks", async () => {
    const { output, log } = createLog()

    /**
     * @param {string} id
     */
    function* work(id) {
      log(`Start ${id}`)
      yield* Task.send(`${id}#1`)
    }

    function* main() {
      const a = Task.fork(work("A"))
      assert.deepEqual(output, [])
      yield* Task.wait(Promise.resolve("one"))
      assert.deepEqual(output, ["Start A"])
      const b = Task.fork(work("B"))
      assert.deepEqual(output, ["Start A"])
      yield* Task.send("hi")
      assert.deepEqual(output, ["Start A", "Start B"])

      const result = yield* b.join()
      assert.deepEqual(result, undefined)

      const result2 = yield* a.join()
      assert.deepEqual(result2, undefined)
    }

    const result = await Task.fork(inspect(main()))

    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: ["hi"],
    })
    assert.deepEqual(output, ["Start A", "Start B"])
  })

  it("failing group member terminates the group", async () => {
    const { output, log } = createLog()
    const boom = new Error("boom")
    function* work(ms = 0, name = "", crash = false) {
      log(`${name} on duty`)
      if (crash) {
        yield* Task.sleep(ms)
        throw boom
      }

      try {
        yield* Task.sleep(ms)
        log(`${name} is done`)
      } finally {
        log(`${name} is clear`)
      }
    }

    function* main() {
      const a = Task.fork(work(1, "A"))
      yield* Task.sleep(2)
      const b = Task.fork(work(8, "B"))
      const c = Task.fork(work(14, "C"))
      const d = Task.fork(work(4, "D", true))
      const e = Task.fork(work(10, "E"))

      try {
        yield* Task.join([a, b, c, d, e])
      } catch (error) {
        yield* Task.sleep(30)
        return { error }
      }
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: { error: boom },
      mail: [],
    })

    assert.deepEqual(
      [...output].sort(),
      [
        "A on duty",
        "B on duty",
        "C on duty",
        "D on duty",
        "E on duty",
        "A is done",
        "E is clear",
        "A is clear",
        "B is clear",
        "C is clear",
      ].sort()
    )
  })

  it("catch linked task error", async () => {
    const { output, log } = createLog()
    const boom = new Error("boom")
    function* crash() {
      yield* Task.sleep()
      throw boom
    }

    function* worker() {
      try {
        log("start work")
        yield* Task.sleep()
      } catch (error) {
        log("catch error")
        assert.equal(Object(error).message, "boom")
        yield* Task.sleep()
        log("after sleep")
      }
    }

    function* main() {
      const fail = Task.fork(crash())
      const succeed = Task.fork(worker())
      yield* Task.join([fail, succeed])
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      error: boom,
      mail: [],
    })

    assert.deepEqual(output, ["start work", "catch error", "after sleep"])
  })

  it("failed task fails the group", async () => {
    const { output, log } = createLog()
    const boom = new Error("boom")

    function* fail(error = boom) {
      throw error
    }
    function* work(ms = 0, name = "") {
      log(`${name} on duty`)

      try {
        yield* Task.sleep(ms)
        log(`${name} is done`)
      } finally {
        log(`${name} cancelled`)
      }
    }

    function* main() {
      const f = Task.fork(fail(boom))
      const a = Task.fork(work(2, "a"))
      yield
      yield* Task.join([a, Task.fork(work(4, "b")), f, Task.fork(work(2, "c"))])
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      error: boom,
      mail: [],
    })
    await Task.fork(Task.sleep(10))
    assert.deepEqual(output, [
      "a on duty",
      "b on duty",
      "a cancelled",
      "b cancelled",
    ])
  })

  it("can make empty group", async () => {
    function* main() {
      return yield* Task.join([])
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: [],
      mail: [],
    })
  })
})
