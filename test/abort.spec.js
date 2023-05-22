import * as Task from "../src/lib.js"
import { assert, createLog, inspect } from "./util.js"

describe("work.abort()", () => {
  it("can abort before task before it starts", async () => {
    const reason = new Error("abort")
    const { log, output } = createLog()

    function* worker() {
      log("sleep worker")
      yield* Task.sleep(3)
      log("wake work")
    }

    function* main() {
      log("begin main")
      const fork = Task.fork(worker())
      yield* fork.abort(reason).join()
      log("end main")
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      mail: [],
      error: reason,
    })

    await Task.fork(Task.sleep(5))

    assert.deepEqual(output, ["begin main"])
  })

  it("can abort pending task", async () => {
    const reason = new Error("abort")
    const { log, output } = createLog()

    function* worker() {
      log("sleep worker")
      yield* Task.sleep(3)
      log("wake work")
    }

    function* main() {
      log("begin main")
      const fork = Task.fork(worker())
      yield // yield to the scheduler so it can start other task
      yield* fork.abort(reason).join()
      log("end main")
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      mail: [],
      error: reason,
    })

    await Task.fork(Task.sleep(5))

    assert.deepEqual(output, ["begin main", "sleep worker"])
  })

  it("calls catch catch on abort", async () => {
    const reason = new Error("abort")
    const { log, output } = createLog()

    function* worker() {
      try {
        log("sleep worker")
        yield* Task.sleep(3)
        log("wake worker")
      } catch (error) {
        log("abort worker")
      }
      log("end worker")
    }

    function* main() {
      log("begin main")
      const fork = Task.fork(worker())
      yield
      yield* fork.abort(reason).join()
      log("end main")
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      mail: [],
      value: undefined,
    })

    await Task.fork(Task.sleep(5))

    assert.deepEqual(output, [
      "begin main",
      "sleep worker",
      "abort worker",
      "end worker",
      "end main",
    ])
  })

  it("calls finally after abort", async () => {
    const reason = new Error("abort")
    const { log, output } = createLog()

    function* worker() {
      try {
        log("sleep worker")
        yield* Task.sleep(3)
        log("wake worker")
      } finally {
        log("clear worker")
      }
      log("end worker")
    }

    function* main() {
      log("begin main")
      const fork = Task.fork(worker())
      yield
      yield* fork.abort(reason).join()
      log("end main")
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      mail: [],
      error: reason,
    })

    await Task.fork(Task.sleep(5))

    assert.deepEqual(output, ["begin main", "sleep worker", "clear worker"])
  })

  it("can run tasks on caught abort", async () => {
    let { output, log } = createLog()
    function* main() {
      log("fork worker")
      const fork = Task.fork(worker())
      log("nap")
      yield* Task.sleep(1)
      log("abort worker")
      yield* fork.abort(new Error("kill")).join()
      log("exit main")
    }

    function* worker() {
      try {
        log("start worker")
        yield* Task.sleep(20)
        log("wake worker")
      } catch (error) {
        log(`aborted ${error}`)
        yield* Task.sleep(2)
        log("ok bye")
      }
    }

    const expect = [
      "fork worker",
      "nap",
      "start worker",
      "abort worker",
      "aborted Error: kill",
      "ok bye",
      "exit main",
    ]

    await Task.fork(main())
    assert.deepEqual(output, expect)
    await Task.fork(Task.sleep(10))
  })

  it("can abort itself", async () => {
    const reason = new Error("abort")
    const { log, output } = createLog()

    function* main() {
      const work = Task.current()
      yield* work.abort(reason).join()
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      error: reason,
      mail: [],
    })
  })
})
