import * as Task from "../src/scratch.js"
import { assert, createLog, inspect } from "./util.js"

describe.only("subtasks", () => {
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
      yield* Task.fork(work("A"))
      yield* Task.wait(Promise.resolve("one"))
      yield* Task.fork(work("B"))
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
      const a = yield* Task.fork(worker("A"))
      assert.deepEqual(output, ["Start A"])
      yield* Task.wait(Promise.resolve("one"))
      const b = yield* Task.fork(worker("B"))
      assert.deepEqual(output, ["Start A", "Start B"])
      yield* Task.send("hi")
      yield* Task.join(a, b)

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
      const a = yield* Task.fork(work("A"))
      assert.deepEqual(output, ["Start A"])
      yield* Task.wait(Promise.resolve("one"))
      const b = yield* Task.fork(work("B"))
      assert.deepEqual(output, ["Start A", "Start B"])
      yield* Task.send("hi")

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

  it("faling group member terminates group", async () => {
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
      const a = yield* Task.fork(work(1, "A"))
      yield* Task.sleep(2)
      const b = yield* Task.fork(work(8, "B"))
      const c = yield* Task.fork(work(14, "C"))
      const d = yield* Task.fork(work(4, "D", true))
      const e = yield* Task.fork(work(10, "E"))

      try {
        yield* Task.join(a, b, c, d, e)
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
      const fail = yield* Task.fork(crash())
      const succeed = yield* Task.fork(worker())
      yield* Task.join(fail, succeed)
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
      const f = yield* Task.fork(fail(boom))
      const a = yield* Task.fork(work(2, "a"))
      yield* Task.sleep()
      yield* Task.join(a, Task.fork(work(4, "b")), f, Task.fork(work(2, "c")))
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
      return yield* Task.join()
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: [],
      mail: [],
    })
  })
})

describe("concurrency", () => {
  it("can run tasks concurrently", async () => {
    /**
     * @param {string} name
     * @param {number} duration
     * @param {number} count
     */
    function* worker(name, duration, count) {
      let n = 0
      while (n++ < count) {
        yield* Task.sleep(duration)
        yield* Task.send(`${name}#${n}`)
      }
    }

    function* main() {
      const a = yield* Task.fork(worker("a", 5, 6))
      yield* Task.sleep(5)
      const b = yield* Task.fork(worker("b", 7, 7))

      yield* Task.join(a, b)
    }

    const result = await Task.fork(inspect(main()))
    const { mail } = result
    assert.deepEqual(
      [...mail].sort(),
      [
        "a#1",
        "a#2",
        "a#3",
        "a#4",
        "a#5",
        "a#6",
        "b#1",
        "b#2",
        "b#3",
        "b#4",
        "b#5",
        "b#6",
        "b#7",
      ],
      "has all the items"
    )
    assert.notDeepEqual([...mail].sort(), mail, "messages are not ordered")
  })

  it("can fork and join", async () => {
    const { output, log } = createLog()
    /**
     * @param {string} name
     */
    function* work(name) {
      log(`> ${name} sleep`)
      yield* Task.sleep(5)
      log(`< ${name} wake`)
    }

    function* main() {
      log("Spawn A")
      const a = yield* Task.fork(work("A"))

      log("Sleep")
      yield* Task.sleep(20)

      log("Spawn B")
      const b = yield* Task.fork(work("B"))

      log("Join")
      const merge = Task.join(a, b)
      yield* merge

      log("Nap")
      yield* Task.sleep(2)

      log("Exit")
    }

    await Task.fork(main(), { name: "🤖" })

    assert.deepEqual(
      [...output],
      [
        "Spawn A",
        "Sleep",
        "> A sleep",
        "< A wake",
        "Spawn B",
        "Join",
        "> B sleep",
        "< B wake",
        "Nap",
        "Exit",
      ]
    )
  })

  it("joining failed task throws", async () => {
    const boom = new Error("boom")
    function* work() {
      throw boom
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep(0)

      yield* worker.join()
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: false,
      error: boom,
      mail: [],
    })
  })
  it("spawn can outlive parent", async () => {
    const { output, log } = createLog()
    const worker = function* () {
      log("start fork")
      yield* Task.sleep(2)
      log("exit fork")
    }

    const main = function* () {
      log("start main")
      yield* Task.spawn(worker())
      log("exit main")
    }

    await Task.fork(main())
    // assert.deepEqual(output, ["start main", "exit main", "start fork"])

    await Task.fork(Task.sleep(20))

    assert.deepEqual(output, [
      "start main",
      "exit main",
      "start fork",
      "exit fork",
    ])
  })

  it("throws on exit", async () => {
    const boom = new Error("boom")
    function* work() {
      try {
        yield* Task.sleep(5)
      } finally {
        throw boom
      }
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep()
      yield* worker.exit()
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      error: boom,
      mail: [],
    })
  })
})
