import { Task } from "../src/lib.js"
import { assert, inspect, createLog } from "./util.js"

describe("Task.fork", () => {
  it("can await on fork result", async () => {
    function* main() {
      yield* Task.sleep(5)
      return { ok: {} }
    }

    const work = Task.fork(main())
    assert.deepEqual(work.state, { pending: {} })
    const result = await work
  })

  it("fails promise if task fails", async () => {
    function* main() {
      throw new Error("boom")
    }

    try {
      const result = await Task.fork(main())
      assert.fail("should be unreachable")
    } catch (error) {
      assert.match(String(error), /boom/)
    }
  })

  it("can use then", async () => {
    function* work() {
      yield* Task.sleep(1)
      return 0
    }

    const result = await Task.fork(work()).then()
    assert.deepEqual(result, 0)
  })

  it("can use catch", async () => {
    const boom = new Error("boom")
    function* work() {
      yield* Task.sleep(1)
      throw boom
    }

    const result = await Task.fork(work()).catch(e => ({ fail: e }))
    assert.deepEqual(result, { fail: boom })
  })

  it("can use finally", async () => {
    const boom = new Error("boom")
    function* work() {
      yield* Task.sleep(1)
      return 0
    }

    let invoked = false
    const result = await Task.fork(work()).finally(() => {
      invoked = true
    })

    assert.deepEqual(result, 0)
    assert.deepEqual(invoked, true)
  })

  it("has toStringTag", async () => {
    const fork = Task.fork(Task.sleep(2))
    assert.deepEqual(String(fork), "[object Workflow]")
  })

  it("can async iterate messages", async () => {
    function* main() {
      yield* Task.send("hello")
      yield* Task.sleep(5)
      yield* Task.send("world")
      return { ok: {} }
    }

    const messages = []
    const work = Task.fork(main())
    for await (const message of work) {
      messages.push(message)
    }
    assert.deepEqual(messages, ["hello", "world"])
    assert.deepEqual(await work, { ok: {} })
  })

  it("can fork a task", async () => {
    const { output, log } = createLog()
    function* worker() {
      log("> start worker")
      yield* Task.send("hello")
      log("< end worker")
    }

    Task.fork(worker())
    assert.deepEqual(output, [])
    await Task.fork(Task.sleep())
    assert.deepEqual(output, ["> start worker", "< end worker"])
  })

  it("can exit forked task", async () => {
    const { output, log } = createLog()
    function* worker(count = 0) {
      log("> start worker")
      let n = 0
      while (n < count) {
        yield* Task.sleep(2)
        log(`>> ${n}`)
        yield* Task.send(`msg ${n++}`)
      }
      log("< end worker")
    }

    const work = Task.fork(worker(3))
    assert.deepEqual(output, [])
    assert.deepEqual(work.state, { pending: {} })

    work.exit()
    await Task.fork(Task.sleep(20))
    assert.equal(output.includes("< end worker"), false)

    assert.deepEqual(work.state, { ok: undefined })
  })

  it("can fork and then join", async () => {
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

      yield* a.join()
    }

    const result = await Task.fork(inspect(main()))
    const { mail } = result

    assert.deepEqual(result.error, undefined)
    assert.deepEqual(
      [...mail].sort(),
      ["a#2", "a#3", "a#4", "a#5", "a#6"],
      "has all but first message from a"
    )
  })
})
