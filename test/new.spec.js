import * as Task from "../src/scratch.js"
import { assert, createLog, inspect } from "./util.js"

// describe("type level errors", () => {
// //   it("must yield* not yield", async () => {
// //     const main = function* () {
// //       yield Task.sleep(2)
// //     }

// //     const error = () => {
// //       // @ts-expect-error - Tells you to use yield*
// //       Task.fork(main())
// //     }
// //   })

// //   it("must yield* not yield", async () => {
// //     const worker = function* () {}
// //     const main = function* () {
// //       // @ts-expect-error tels you to use worker()
// //       yield Task.fork(worker)
// //     }
// //   })
// // })

// describe("can abort", () => {
//   it("can terminate sleeping task", async () => {
//     let { output, log } = createLog()
//     function* main() {
//       log("fork worker")
//       const task = yield* Task.fork(worker())
//       log("nap")
//       yield* Task.sleep(1)
//       log("terminate worker")
//       yield* task.exit()
//       log("exit main")
//     }

//     function* worker() {
//       log("start worker")
//       yield* Task.sleep(20)
//       log("wake worker")
//     }

//     const expect = [
//       "fork worker",
//       "nap",
//       "start worker",
//       "terminate worker",
//       "exit main",
//     ]

//     await Task.fork(main())
//     assert.deepEqual(output, expect)
//     await Task.fork(Task.sleep(30))

//     assert.deepEqual(output, expect)
//   })

//   it("sleeping task can still cleanup", async () => {
//     let { output, log } = createLog()
//     function* main() {
//       log("fork worker")
//       const task = yield* Task.fork(worker())
//       log("nap")
//       yield* Task.sleep(1)
//       log("abort worker")
//       yield* task.exit()
//       log("exit main")
//     }

//     function* worker() {
//       log("start worker")

//       const id = setTimeout(() => {
//         log("timeout fired")
//       }, 10)

//       try {
//         yield* Task.suspend()
//       } finally {
//         clearTimeout(id)
//         log("can clean up even though aborted")
//       }
//     }

//     const expect = [
//       "fork worker",
//       "nap",
//       "start worker",
//       "abort worker",
//       "can clean up even though aborted",
//       "exit main",
//     ]

//     await Task.fork(main())
//     await Task.fork(Task.sleep(30))

//     assert.deepEqual(output, expect)
//   })

//   it("can abort with an error", async () => {
//     let { output, log } = createLog()
//     const kill = new Error("kill")
//     function* main() {
//       log("fork worker")
//       const fork = yield* Task.fork(worker())
//       log("nap")
//       yield* Task.sleep(1)
//       log("abort worker")
//       yield* fork.abort(kill)
//       log("exit main")
//     }

//     function* worker() {
//       try {
//         log("start worker")
//         yield* Task.sleep(20)
//         log("wake worker")
//       } catch (error) {
//         log(`aborted ${error}`)
//       }
//     }

//     const expect = [
//       "fork worker",
//       "nap",
//       "start worker",
//       "abort worker",
//       "aborted Error: kill",
//       "exit main",
//     ]

//     assert.deepEqual(await Task.fork(inspect(main())), {
//       ok: false,
//       error: kill,
//       mail: [],
//     })
//     assert.deepEqual(output, expect)
//     await Task.fork(Task.sleep(30))

//     assert.deepEqual(output, expect)
//   })

//   it("can still do things when aborted", async () => {
//     let { output, log } = createLog()
//     const kill = new Error("kill")
//     function* main() {
//       log("fork worker")
//       const fork = yield* Task.fork(worker())
//       log("nap")
//       yield* Task.sleep(1)
//       log("abort worker")
//       yield* fork.abort(kill)
//       log("exit main")
//     }

//     function* worker() {
//       try {
//         log("start worker")
//         yield* Task.sleep(20)
//         log("wake worker")
//       } catch (error) {
//         assert.equal(error, kill)
//         log(`aborted ${error}`)
//         yield* Task.sleep(2)
//         log("ok bye")
//       }
//     }

//     const expect = [
//       "fork worker",
//       "nap",
//       "start worker",
//       "abort worker",
//       "exit main",
//       "aborted Error: kill",
//     ]

//     assert.deepEqual(await Task.fork(inspect(main())), {
//       ok: false,
//       error: kill,
//       mail: [],
//     })
//     assert.deepEqual(output, expect)
//     await Task.fork(Task.sleep(10))

//     assert.deepEqual(output, [...expect, "ok bye"])
//   })

//   it("can still suspend after aborted", async () => {
//     let { output, log } = createLog()
//     const kill = new Error("kill")
//     function* main() {
//       log("fork worker")
//       const fork = yield* Task.fork(worker())
//       log("nap")
//       yield* Task.sleep(1)
//       log("abort worker")
//       yield* fork.abort(kill)
//       log("exit main")
//     }

//     function* worker() {
//       try {
//         log("start worker")
//         yield* Task.sleep(20)
//         log("wake worker")
//       } catch (error) {
//         log(`aborted ${error}`)
//         yield* Task.sleep(2)
//         log("suspend after abort")
//         yield* Task.sleep()
//         log("ok bye now")
//       }
//     }

//     const expect = [
//       "fork worker",
//       "nap",
//       "start worker",
//       "abort worker",
//       "exit main",
//       "aborted Error: kill",
//     ]

//     assert.deepEqual(await Task.fork(inspect(main())), {
//       ok: false,
//       error: kill,
//       mail: [],
//     })
//     assert.deepEqual(output, expect)
//     await Task.fork(Task.sleep(10))

//     assert.deepEqual(output, [...expect, "suspend after abort", "ok bye now"])
//   })

//   it("can exit the task", async () => {
//     let { output, log } = createLog()
//     function* main() {
//       log("fork worker")
//       const fork = yield* Task.fork(worker())
//       log("nap")
//       yield* Task.sleep(1)
//       log("exit worker")
//       yield* fork.exit()
//       log("exit main")
//     }

//     function* worker() {
//       try {
//         log("start worker")
//         yield* Task.sleep(20)
//         log("wake worker")
//       } catch (error) {
//         log(`aborted ${error}`)
//       }
//     }

//     const expect = [
//       "fork worker",
//       "nap",
//       "start worker",
//       "exit worker",
//       "exit main",
//     ]

//     await Task.fork(main())
//     assert.deepEqual(output, expect)
//     await Task.fork(Task.sleep(30))

//     assert.deepEqual(output, expect)
//   })
// })

// describe("promise", () => {
//   it("fails promise if task fails", async () => {
//     function* main() {
//       throw new Error("boom")
//     }

//     try {
//       const result = await Task.fork(main())
//       assert.fail("should be unreachable")
//     } catch (error) {
//       assert.match(String(error), /boom/)
//     }
//   })

//   it("can use then", async () => {
//     function* work() {
//       yield* Task.sleep(1)
//       return 0
//     }

//     const result = await Task.fork(work()).then()
//     assert.deepEqual(result, 0)
//   })

//   it("can use catch", async () => {
//     const boom = new Error("boom")
//     function* work() {
//       yield* Task.sleep(1)
//       throw boom
//     }

//     const result = await Task.fork(work()).catch(e => e)
//     assert.deepEqual(result, boom)
//   })

//   it("can use finally", async () => {
//     const boom = new Error("boom")
//     function* work() {
//       yield* Task.sleep(1)
//       return 0
//     }

//     let invoked = false
//     const result = await Task.fork(work()).finally(() => {
//       invoked = true
//     })

//     assert.deepEqual(result, 0)
//     assert.deepEqual(invoked, true)
//   })

//   it("has toStringTag", async () => {
//     const fork = Task.fork(Task.sleep(2))
//     assert.deepEqual(String(fork), "[object Fork]")
//   })
// })

// describe("tag", () => {
//   it("tags effect", async () => {
//     function* fx() {
//       yield* Task.send(1)
//       yield* Task.sleep(2)

//       yield* Task.send(2)
//     }

//     const result = await inspect(Task.tag(fx(), "fx"))
//     assert.deepEqual(result, {
//       ok: true,
//       value: undefined,
//       mail: [
//         { type: "fx", fx: 1 },
//         { type: "fx", fx: 2 },
//       ],
//     })
//   })

//   it("tags with errors", async () => {
//     const error = new Error("boom")
//     function* fx() {
//       yield* Task.send(1)
//       throw error
//     }

//     function* main() {
//       yield* Task.tag(fx(), "fx")
//     }

//     const result = await Task.fork(inspect(main()))
//     assert.deepEqual(result, {
//       ok: false,
//       error,
//       mail: [{ type: "fx", fx: 1 }],
//     })
//   })

//   it("can terminate tagged", async () => {
//     const { output, log } = createLog()
//     function* fx() {
//       yield* Task.send(1)
//       log("send 1")
//       yield* Task.sleep(1)
//       yield* Task.send(2)
//       log("send 2")
//     }

//     function* main() {
//       const fork = yield* Task.fork(Task.tag(fx(), "fx"))
//       yield* Task.sleep(1)
//       yield* Task.terminate(fork)
//     }

//     const result = await Task.fork(inspect(main()))
//     assert.deepEqual(result, {
//       ok: true,
//       value: undefined,
//       mail: [],
//     })
//     assert.deepEqual(output, ["send 1"])
//     await Task.fork(Task.sleep(5))

//     assert.deepEqual(output, ["send 1"])
//   })

//   it("can abort tagged", async () => {
//     const { output, log } = createLog()
//     function* fx() {
//       yield* Task.send(1)
//       log("send 1")
//       yield* Task.sleep(1)
//       yield* Task.send(2)
//       log("send 2")
//     }

//     function* main() {
//       const tagged = Task.tag(fx(), "fx")
//       assert.equal(String(tagged), "[object TaggedEffect]")
//       const fork = yield* Task.fork(tagged)
//       yield* Task.sleep(1)
//       yield* Task.abort(fork, new Error("kill"))
//     }

//     const result = await Task.fork(inspect(main()))
//     assert.deepEqual(result, {
//       ok: true,
//       value: undefined,
//       mail: [],
//     })
//     assert.deepEqual(output, ["send 1"])
//     await Task.fork(Task.sleep(5))

//     assert.deepEqual(output, ["send 1"])
//   })

//   it("can double tag", async () => {
//     function* fx() {
//       yield* Task.send(1)
//       yield* Task.sleep(1)
//       yield* Task.send(2)
//     }

//     const tagged = Task.tag(Task.tag(fx(), "foo"), "bar")

//     assert.deepEqual(await inspect(tagged), {
//       ok: true,
//       value: undefined,
//       mail: [
//         { type: "bar", bar: { type: "foo", foo: 1 } },
//         { type: "bar", bar: { type: "foo", foo: 2 } },
//       ],
//     })
//   })

//   it("tagging none is noop", async () => {
//     function* fx() {
//       yield* Task.send(1)
//       yield* Task.sleep(1)
//       yield* Task.send(2)
//     }

//     const tagged = Task.tag(Task.tag(Task.none(), "foo"), "bar")
//     assert.deepEqual(await inspect(tagged), {
//       ok: true,
//       value: undefined,
//       mail: [],
//     })
//     assert.equal(tagged, Task.none())
//   })
// })

// describe("effect", () => {
//   it("can listen to several fx", async () => {
//     /**
//      * @param {number} delay
//      * @param {number} count
//      */
//     function* source(delay, count) {
//       let start = Date.now()
//       let n = 0
//       while (n < count) {
//         yield* Task.send(n)
//         n++
//         yield* Task.sleep(delay)
//       }
//     }

//     const fx = Task.listen({
//       beep: source(3, 5),
//       bop: source(5, 3),
//       buz: source(2, 2),
//     })

//     const { mail, ...result } = await inspect(fx)
//     assert.deepEqual(result, { ok: true, value: undefined })
//     const inbox = mail.map(m => JSON.stringify(m))

//     const expect = [
//       { type: "beep", beep: 0 },
//       { type: "beep", beep: 1 },
//       { type: "beep", beep: 2 },
//       { type: "beep", beep: 3 },
//       { type: "beep", beep: 4 },
//       { type: "bop", bop: 0 },
//       { type: "bop", bop: 1 },
//       { type: "bop", bop: 2 },
//       { type: "buz", buz: 0 },
//       { type: "buz", buz: 1 },
//     ]

//     assert.notDeepEqual(
//       [...inbox].sort(),
//       inbox,
//       "messages aren not ordered by actors"
//     )
//     assert.deepEqual(
//       [...inbox].sort(),
//       [...expect.map(v => JSON.stringify(v))].sort(),
//       "all messages were received"
//     )
//   })

//   it("can listen to none", async () => {
//     assert.deepEqual(await inspect(Task.listen({})), {
//       ok: true,
//       value: undefined,
//       mail: [],
//     })
//   })

//   it("can produces no messages on empty tasks", async () => {
//     const { log, output } = createLog()
//     function* work() {
//       console.log("start work")
//       yield* Task.sleep(2)
//       console.log("end work")
//     }
//     const main = Task.listen({
//       none: work(),
//     })

//     assert.deepEqual(await inspect(main), {
//       ok: true,
//       value: undefined,
//       mail: [],
//     })
//   })

//   it("can turn task into effect", async () => {
//     function* work() {
//       Task.sleep(1)
//       return "hi"
//     }

//     const fx = Task.effect(work())

//     assert.deepEqual(await inspect(fx), {
//       ok: true,
//       value: undefined,
//       mail: ["hi"],
//     })
//   })

//   it("can turn multiple tasks into effect", async () => {
//     function* fx(msg = "", delay = 1) {
//       yield* Task.sleep(delay)
//       return msg
//     }

//     const effect = Task.effects([fx("foo", 5), fx("bar", 1), fx("baz", 2)])
//     assert.deepEqual(await inspect(effect), {
//       ok: true,
//       value: undefined,
//       mail: ["bar", "baz", "foo"],
//     })
//   })

//   it("can turn 0 tasks into effect", async () => {
//     const effect = Task.effects([])
//     assert.deepEqual(await inspect(effect), {
//       ok: true,
//       value: undefined,
//       mail: [],
//     })
//   })

//   it("can batch multiple effects", async () => {
//     function* fx(msg = "", delay = 1) {
//       yield* Task.sleep(delay)
//       yield* Task.send(msg)
//     }

//     const effect = Task.batch([fx("foo", 5), fx("bar", 1), fx("baz", 2)])
//     assert.deepEqual(await inspect(effect), {
//       ok: true,
//       value: undefined,
//       mail: ["bar", "baz", "foo"],
//     })
//   })

//   it("can loop", async () => {
//     const { log, output } = createLog()
//     function* step({ n } = { n: 0 }) {
//       log(`<< ${n}`)
//       while (--n > 0) {
//         log(`>> ${n}`)
//         yield* Task.sleep(n)
//         yield* Task.send({ n })
//       }
//     }

//     const main = await Task.fork(Task.loop(step({ n: 4 }), step))

//     assert.notDeepEqual([...output].sort(), output)
//     assert.deepEqual(
//       [...output].sort(),
//       [
//         "<< 4",
//         ">> 3",
//         ">> 2",
//         ">> 1",
//         "<< 3",
//         ">> 2",
//         ">> 1",
//         "<< 2",
//         ">> 1",
//         "<< 1",
//         "<< 2",
//         ">> 1",
//         "<< 1",
//         "<< 1",
//         "<< 1",
//       ].sort()
//     )
//   })

//   it("can wait in a loop", async () => {
//     const { log, output } = createLog()
//     const main = Task.loop(Task.send("start"), function* (message) {
//       log(`<< ${message}`)
//       const result = yield* Task.wait(0)
//       log(`>> ${result}`)
//     })

//     assert.deepEqual(await Task.fork(main), undefined)
//     assert.deepEqual(output, ["<< start", ">> 0"])
//   })
// })

// describe("all operator", () => {
//   it("can get all results", async () => {
//     const { output, log } = createLog()

//     /** @type {(d:number, r:string) => Task.Task<string, never>} */
//     function* work(duration, result) {
//       yield* Task.sleep(duration)
//       log(result)
//       return result
//     }

//     function* main() {
//       const result = yield* Task.all([
//         work(2, "a"),
//         work(9, "b"),
//         work(5, "c"),
//         work(0, "d"),
//       ])

//       return result
//     }

//     const result = await Task.fork(main())
//     assert.deepEqual(result, ["a", "b", "c", "d"])
//     assert.notDeepEqual(result, output)
//     assert.deepEqual([...result].sort(), [...output].sort())
//   })

//   it("on failur all other tasks are aborted", async () => {
//     const { output, log } = createLog()

//     /** @type {(d:number, n:string, c?:boolean) => Task.Task<string, never>} */
//     function* work(duration, name, crash = false) {
//       yield* Task.sleep(duration)
//       log(name)
//       if (crash) {
//         throw name
//       } else {
//         return name
//       }
//     }

//     function* main() {
//       const result = yield* Task.all([
//         work(2, "a"),
//         work(9, "b"),
//         work(5, "c", true),
//         work(0, "d"),
//         work(8, "e"),
//       ])

//       return result
//     }

//     const result = await Task.fork(inspect(main()))
//     assert.deepEqual(result, {
//       ok: false,
//       error: "c",
//       mail: [],
//     })

//     await Task.fork(Task.sleep(20))
//     assert.deepEqual([...output].sort(), ["d", "a", "c"].sort())
//   })

//   it("can make all of none", async () => {
//     assert.deepEqual(await Task.fork(Task.all([])), [])
//   })
// })

// describe("Fork API", () => {
//   it("can use abort method", async () => {
//     const { output, log } = createLog()
//     const kill = new Error("kill")
//     function* work() {
//       log("start work")
//       yield* Task.sleep(2)
//       log("end work")
//     }

//     function* main() {
//       const worker = yield* Task.fork(work())
//       yield* Task.sleep(0)
//       log("kill")
//       yield* worker.abort(kill)
//       log("nap")
//       yield* Task.sleep(5)
//       log("exit")
//     }

//     await Task.fork(main())
//     assert.deepEqual(output, ["start work", "kill", "nap", "exit"])
//   })
//   it("can use exit method", async () => {
//     const { output, log } = createLog()
//     const kill = new Error("kill")
//     function* work() {
//       try {
//         log("start work")
//         yield* Task.sleep(2)
//         log("end work")
//       } finally {
//         log("cancel work")
//       }
//     }

//     function* main() {
//       const worker = yield* Task.fork(work())
//       yield* Task.sleep(0)
//       log("kill")
//       yield* worker.exit()
//       log("nap")
//       yield* Task.sleep(5)
//       log("exit")
//     }

//     await Task.fork(main())
//     assert.deepEqual(output, [
//       "start work",
//       "kill",
//       "cancel work",
//       "nap",
//       "exit",
//     ])
//   })

//   it("can use resume method", async () => {
//     const { output, log } = createLog()
//     function* work() {
//       log("suspend work")
//       yield* Task.suspend()
//       log("resume work")
//     }

//     function* main() {
//       const worker = yield* Task.fork(work())
//       yield* Task.sleep(2)
//       yield* worker.resume()
//       log("exit")
//     }

//     await Task.fork(main())
//     assert.deepEqual(output, ["suspend work", "exit", "resume work"])
//   })

//   it("can use join method", async () => {
//     function* work() {
//       yield* Task.send("a")
//       yield* Task.sleep(2)
//       yield* Task.send("b")
//       return 0
//     }

//     function* main() {
//       const worker = yield* Task.fork(work())
//       yield* Task.sleep(0)
//       const result = yield* worker.join()
//       return result
//     }

//     const result = await Task.fork(inspect(main()))
//     assert.deepEqual(result, {
//       ok: true,
//       value: 0,
//       mail: ["b"],
//     })
//   })

//   it("has toStringTag", async () => {
//     function* main() {
//       const fork = yield* Task.fork(Task.sleep(2))
//       return String(fork)
//     }

//     assert.deepEqual(await Task.fork(main()), "[object Fork]")
//   })

//   it("is iterator", async () => {
//     function* work() {
//       yield* Task.send("a")
//       yield* Task.send("b")
//       yield* Task.send("c")
//     }
//     function* main() {
//       const fork = yield* Task.fork(work())
//       return [...fork]
//     }

//     assert.deepEqual(await Task.fork(main()), [])
//   })

//   it("can join non-active fork", async () => {
//     function* work() {
//       yield* Task.send("hi")
//     }

//     const worker = Task.fork(work())

//     function* main() {
//       yield* Task.join(worker)
//     }

//     assert.deepEqual(await Task.fork(inspect(main())), {
//       mail: ["hi"],
//       ok: true,
//       value: undefined,
//     })
//   })
// })

// describe("hang", () => {
//   it.only("will cleanup joined children", async () => {
//     const { log, output } = createLog()
//     function* hang() {
//       try {
//         yield* Task.suspend()
//       } finally {
//         log("cleanup hang")
//       }
//     }

//     function* work() {
//       try {
//         const fork = yield* Task.fork(hang())
//         yield* Task.join(fork)
//       } finally {
//         log("cleanup work")
//       }
//     }

//     function* main() {
//       const worker = yield* Task.fork(work())
//       yield* Task.sleep()
//       yield* Task.exit(worker, undefined)
//     }

//     assert.deepEqual(await Task.fork(inspect(main())), {
//       ok: true,
//       value: undefined,
//       mail: [],
//     })
//     assert.deepEqual(output, ["cleanup hang", "cleanup work"])
//   })

//   it.skip("can hang", async () => {
//     /**
//      * @template T
//      * @param {T[]} [buffer]
//      */
//     const createChannel = function (buffer = []) {
//       /** @type {Array<T|null>} */
//       const queue = buffer
//       /** @type {Task.Controller<null, never, T>} */
//       let controller
//       function* work() {
//         const current = yield* Task.current()
//         controller = current
//         while (true) {
//           while (queue.length > 0) {
//             for (const message of queue.splice(0)) {
//               if (message === null) {
//                 return
//               } else {
//                 yield* Task.send(message)
//               }
//             }
//           }
//           yield* Task.suspend()
//         }
//       }

//       /**
//        * @param {T|null} message
//        */
//       const send = function (message) {
//         queue.push(message)
//         if (controller) {
//           Task.resume(controller)
//         }
//       }

//       const exit = () => send(null)

//       const outbox = { send, exit }
//       /** @type {Task.Effect<T>} */
//       const inbox = work()
//       return { inbox, outbox }
//     }

//     const { log, output } = createLog()
//     let dispatch = (n = 0) => {}

//     function* exit() {
//       const current = yield* Task.current()
//       console.log("exit", current)
//       yield* Task.exit(current, undefined)
//     }

//     /**
//      * @template S, M
//      * @param {() => [S, Task.Effect<M>]} init
//      * @param {(message:M, state:S) => [S, Task.Effect<M>]} update
//      * @returns
//      */
//     const program = (init, update) => {
//       const { inbox, outbox } = createChannel(/** @type {M[]} */ ([]))
//       let [state, fx] = init()
//       return Task.loop(Task.batch([inbox, fx]), message => {
//         const [next, fx] = update(message, state)
//         state = next
//         return fx
//       })
//     }

//     const main = program(
//       () => [{ n: 0 }, Task.send(1)],
//       (n, state) => {
//         const next = { n: state.n + n }
//         console.log({ n, next })
//         log(`<- ${n}@${state.n}`)
//         const fx = next.n > 64 ? exit() : Task.send(next.n * 2)
//         return [next, fx]
//       }
//     )

//     assert.deepEqual(await inspect(main), {
//       ok: true,
//       value: undefined,
//       mail: [],
//     })
//   })
// })

describe("cleanup", () => {
  it("will cleanup joined children", async () => {
    const { log, output } = createLog()
    function* hang() {
      try {
        log("start hang")
        yield* Task.sleep(21)
      } finally {
        log("cleanup hang")
      }
    }

    function* work() {
      try {
        log("start work")
        const fork = yield* Task.fork(hang())
        yield* fork.join()
      } finally {
        log("cleanup work")
      }
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep()
      yield* worker.exit()
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: undefined,
      mail: [],
    })
    assert.deepEqual(output, [
      "start work",
      "start hang",
      "cleanup hang",
      "cleanup work",
    ])
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
        const fork = yield* Task.fork(hang())
        yield* fork.join()
      } finally {
        log("cleanup work")
      }
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep(20)
      yield* worker.exit()
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
        const fork = yield* Task.fork(hang())
        yield* fork.join()
      } finally {
        log("cleanup work")
      }
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep(20)
      yield* worker.exit()
    }

    const out = await Task.fork(inspect(main()))
    assert.deepEqual(out, {
      ok: false,
      error,
      mail: [],
    })
    assert.deepEqual(output, ["cleanup hang", "cleanup work"])
  })
})
