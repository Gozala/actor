import * as Task from "../src/lib.js"
import { assert, createLog, inspect } from "./util.js"

describe("Task.join", () => {
  it("joined tasks delegate messages", async () => {
    const abort = new Error("abort")
    function* work(name = "anonymous") {
      yield* Task.send(name)
      yield* Task.sleep()
    }

    function* main() {
      yield* Task.join([
        Task.fork(work("alice")),
        Task.fork(work("bob")),
        Task.fork(work("jordan")),
      ])
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: undefined,
      mail: ["alice", "bob", "jordan"],
    })
  })

  it("failed task fails join", async () => {
    const boom = new Error("boom")

    function* fail() {
      yield* Task.sleep()
      throw boom
    }

    function* succeed(value = 0) {
      yield* Task.sleep()
      return value
    }

    function* main() {
      const ok = Task.fork(succeed(5))
      const error = Task.fork(fail())

      yield* Task.join([ok, error])
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      error: boom,
      mail: [],
    })
  })

  it("can collect results", async () => {
    function* inc(n = 0) {
      yield* Task.send(n)
      return n + 1
    }

    function* main() {
      const a = Task.fork(inc(5))
      const b = Task.fork(inc(16))

      const result = yield* Task.join([a, b])
      return result
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: [6, 17],
      mail: [5, 16],
    })
  })

  it("will cleanup joined children", async () => {
    const { log, output } = createLog()
    function* hang() {
      try {
        yield* Task.suspend()
      } finally {
        log("cleanup hang")
      }
    }

    function* work() {
      try {
        const fork = Task.fork(hang())
        yield* fork.join()
      } finally {
        log("cleanup work")
      }
    }

    function* main() {
      const worker = Task.fork(work())
      yield* Task.sleep()
      yield* worker.exit().join()
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: undefined,
      mail: [],
    })
    assert.deepEqual(output, ["cleanup hang", "cleanup work"])
  })

  it("children can do tasks on exit", async () => {
    const { log, output } = createLog()
    function* hang() {
      try {
        yield* Task.sleep(21)
      } finally {
        log("cleanup hang")
        Task.sleep(3)
        log("hang out")
      }
    }

    function* work() {
      try {
        const fork = Task.fork(hang())
        yield* fork.join()
      } finally {
        log("cleanup work")
      }
    }

    function* main() {
      const worker = Task.fork(work())
      yield* Task.sleep(20)
      yield* worker.exit().join()
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: [],
    })
    assert.deepEqual(output, ["cleanup hang", "hang out", "cleanup work"])
  })

  it("children can throw on exit but still cleanup", async () => {
    const { log, output } = createLog()
    const error = new Error("staying alive")
    function* hang() {
      try {
        yield* Task.sleep(21)
      } finally {
        log("cleanup hang")
        throw error
      }
    }

    function* work() {
      try {
        const fork = Task.fork(hang())
        yield* fork.join()
      } finally {
        log("cleanup work")
      }
    }

    function* main() {
      const worker = Task.fork(work())
      yield* Task.sleep(20)
      yield* worker.exit().join()
    }

    const out = await Task.fork(inspect(main()))
    assert.deepEqual(out, {
      ok: false,
      error,
      mail: [],
    })
    assert.deepEqual(output, ["cleanup hang", "cleanup work"])
  })

  it("can join same task multiple times", async () => {
    const { log, output } = createLog()
    function* work() {
      log("start work")
      yield* Task.sleep(0)
      log("end work")
    }

    function* main() {
      const fork = Task.fork(work())
      yield* fork.join()
      yield* fork.join()
    }

    const result = await Task.fork(main())
    assert.deepEqual(result, undefined)
  })

  it("can join itself", async () => {
    const result = await Task.spawn(function* () {
      const work = Task.current()
      yield* work.join()
      return {}
    })

    assert.deepEqual(result, {})
  })

  it("can join then abort", async () => {
    const boom = new Error("boom")
    const main = Task.spawn(function* () {
      yield* Task.fork(Task.sleep(5)).join()
    })

    await Task.fork(Task.sleep())
    const result = await main.abort(boom).catch(error => ({
      catch: error,
    }))

    assert.deepEqual(result, { catch: boom })
  })

  it("can join then exit", async () => {
    const main = Task.spawn(function* () {
      yield* Task.fork(Task.sleep(5)).join()
      return 1
    })

    await Task.fork(Task.sleep())
    assert.deepEqual(main.state, { pending: {} })
    const result = await main.exit(0)

    console.log(result)

    assert.deepEqual(result, 0)
  })

  it("can join non-active fork", async () => {
    function* work() {
      yield
      yield* Task.send("hi")
    }

    const worker = Task.fork(work())

    function* main() {
      yield* worker.join()
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      mail: ["hi"],
      ok: true,
      value: undefined,
    })
  })
})
