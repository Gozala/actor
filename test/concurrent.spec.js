import * as Task from "../src/next.js"
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

      yield* Task.join(a, b)
    }

    const result = await Task.perform(inspect(main()))
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
      const merge = Task.join(a, b)
      yield* merge

      log("Nap")
      yield* Task.sleep(2)

      log("Exit")
    }

    await Task.perform(main())

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

      yield* Task.join(worker)
    }

    const result = await Task.perform(inspect(main()))
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
      Task.fork(worker())
      log("exit main")
    }

    await Task.perform(Task.fork(main()).join())
    // assert.deepEqual(output, ["start main", "exit main", "start fork"])

    await Task.perform(Task.sleep(20))

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

    assert.deepEqual(await Task.perform(inspect(main())), {
      ok: false,
      error: boom,
      mail: [],
    })
  })

  it("exception in errored fork propagates through exit", async () => {
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

    assert.deepEqual(await Task.perform(inspect(main())), {
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

    assert.deepEqual(await Task.perform(inspect(main())), {
      ok: true,
      value: { worker: boom },
      mail: [],
    })
  })

  it("error in forked thread does not affect spawner", async () => {
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

    assert.deepEqual(await Task.perform(inspect(main())), {
      ok: true,
      value: "done",
      mail: [],
    })

    assert.equal(threw, true)
  })

  it("exiting parent task exits children", async () => {
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

    assert.deepEqual(await Task.perform(inspect(main())), {
      ok: true,
      value: "done",
      mail: [],
    })

    await Task.perform(Task.sleep(20))

    assert.equal(threw, true)
  })
})
