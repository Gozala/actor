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

  it("can await after completion", async () => {
    const work = Task.fork(Task.succeed(0))
    await Task.fork(Task.sleep(1))
    assert.deepEqual(await work, 0)
    assert.deepEqual(await work, 0)
  })

  it("can await after workflow failed", async () => {
    const work = Task.fork(Task.fail("boom"))
    await Task.fork(Task.sleep(1))
    assert.deepEqual(await work.catch(error => ({ catch: error })), {
      catch: "boom",
    })
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

  it("async iteration errors on workflow failure", async () => {
    function* main() {
      yield* Task.send("hello")
      yield* Task.sleep(5)
      yield* Task.send("world")
      throw "boom"
    }

    const work = Task.fork(main())
    const messages = []
    let error = undefined

    try {
      for await (const message of work) {
        messages.push(message)
      }
    } catch (cause) {
      error = cause
    }

    assert.deepEqual(messages, ["hello", "world"])
    assert.deepEqual(error, "boom")
    assert.deepEqual(work.state, { error: "boom" })
  })

  it("can async iterate finished workflow", async () => {
    const work = Task.fork(Task.send("hello"))
    await Task.fork(Task.sleep(1))

    const messages = []
    for await (const message of work) {
      messages.push(message)
    }
    assert.deepEqual(messages, [])
  })

  it("throws when async iterating errored workflow", async () => {
    const work = Task.fork(Task.fail("boom"))
    await Task.fork(Task.sleep(1))

    let error = undefined

    try {
      const messages = []
      for await (const message of work) {
        messages.push(message)
      }
    } catch (cause) {
      error = cause
    }

    assert.deepEqual(error, "boom")
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

  it("can abort forked task", async () => {
    const { output, log } = createLog()
    const boom = new Error("boom")
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

    work.abort(boom)
    await Task.fork(Task.sleep(20))
    assert.equal(output.includes("< end worker"), false)

    assert.deepEqual(work.state, { error: boom })
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

  it("can resume a workflow", async () => {
    const { output, log } = createLog()
    function* work() {
      log("suspend work")
      yield* Task.suspend()
      log("resume work")
    }

    function* main() {
      const worker = Task.fork(work())
      yield* Task.sleep(2)
      worker.resume()
      log("exit")
    }

    await Task.fork(main())
    assert.deepEqual(output, ["suspend work", "exit", "resume work"])
  })

  it("can join outside workflow", async () => {
    function* work() {
      yield* Task.send("hi")
      yield* Task.sleep(2)
      yield* Task.send("bye")
    }

    const worker = Task.fork(work())

    function* main() {
      yield* worker.join()
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      mail: ["bye"],
      ok: true,
      value: undefined,
    })
  })
})
