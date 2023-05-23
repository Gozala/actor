import { Task } from "../src/lib.js"
import { assert, inspect, createLog } from "./util.js"

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
      const a = Task.fork(worker("a", 5, 6))
      yield* Task.sleep(8)
      const b = Task.fork(worker("b", 7, 7))

      yield* Task.join([a, b])
    }

    const result = await Task.fork(inspect(main()))
    const { mail } = result

    assert.equal(result.ok, true)
    assert.deepEqual(
      [...mail].sort(),
      [
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

  it("immediate join precedes forked task", async () => {
    const { log, output } = createLog()
    /**
     * @param {string} name
     * @param {number} duration
     * @param {number} count
     */
    function* worker(name, duration, count) {
      log(`start ${name}`)
      let n = 0
      while (n++ < count) {
        yield* Task.sleep(duration)
        yield* Task.send(`${name}#${n}`)
      }
      log(`end ${name}`)
    }

    function* main() {
      log("fork a")
      const a = Task.fork(worker("a", 5, 6))
      log("fork b")
      const b = Task.fork(worker("b", 7, 7))
      log("join a and b")
      yield* Task.join([a, b])
      log("done")
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
    assert.deepEqual(output, [
      "fork a",
      "fork b",
      "join a and b",
      "start a",
      "start b",
      "end a",
      "end b",
      "done",
    ])
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
      const a = Task.fork(work("A"))

      log("Sleep")
      yield* Task.sleep(20)

      log("Spawn B")
      const b = Task.fork(work("B"))

      log("Join")
      const merge = Task.join([a, b])
      yield* merge

      log("Nap")
      yield* Task.sleep(2)

      log("Exit")
    }

    await Task.fork(main())

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
      const worker = Task.fork(work())
      yield* Task.sleep(0)

      yield* Task.join([worker])
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: false,
      error: boom,
      mail: [],
    })
  })

  it("fork can outlive parent", async () => {
    const { output, log } = createLog()
    const worker = function* () {
      log("start fork")
      yield* Task.sleep(2)
      log("exit fork")
    }

    const main = function* () {
      log("start main")
      Task.fork(worker())
      log("exit main")
    }

    await Task.fork(Task.fork(main()).join())
    // assert.deepEqual(output, ["start main", "exit main", "start fork"])

    await Task.fork(Task.sleep(20))

    assert.deepEqual(output, [
      "start main",
      "exit main",
      "start fork",
      "exit fork",
    ])
  })

  it("exception in worker finally propagates to exit", async () => {
    const boom = new Error("boom")
    function* work() {
      try {
        yield* Task.sleep(5)
      } finally {
        throw boom
      }
    }

    function* main() {
      const worker = Task.fork(work())
      yield* Task.sleep()
      yield* worker.exit().join()
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      error: boom,
      mail: [],
    })
  })

  it("exception in errored fork propagates through exit().join()", async () => {
    const boom = new Error("boom")
    function* work() {
      try {
        yield* Task.sleep(5)
      } finally {
        throw boom
      }
    }

    function* main() {
      const worker = Task.fork(work())
      yield* Task.sleep(20)
      yield* worker.exit().join()
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      error: boom,
      mail: [],
    })
  })

  it("can catch exception in worker finally", async () => {
    const boom = new Error("boom")
    function* work() {
      try {
        yield* Task.sleep(5)
      } finally {
        throw boom
      }
    }

    function* main() {
      const worker = Task.fork(work())
      yield* Task.sleep()
      try {
        yield* worker.exit().join()
      } catch (error) {
        return { worker: error }
      }
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: { worker: boom },
      mail: [],
    })
  })

  it("error in forked thread does not affect parent", async () => {
    const boom = new Error("boom")

    let threw = false

    function* work() {
      try {
        yield* Task.sleep(5)
      } finally {
        threw = true
        throw boom
      }
    }

    function* main() {
      const worker = Task.fork(work())
      yield* Task.sleep(20)
      return "done"
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: "done",
      mail: [],
    })

    assert.equal(threw, true)
  })

  it("exiting parent does not exits children", async () => {
    const boom = new Error("boom")
    let threw = false
    function* work() {
      try {
        yield* Task.sleep(5)
      } finally {
        threw = true
        throw boom
      }
    }

    function* main() {
      const worker = Task.fork(work())
      yield* Task.sleep(0)
      return "done"
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: "done",
      mail: [],
    })

    await Task.fork(Task.sleep(20))

    assert.equal(threw, true)
  })
})
