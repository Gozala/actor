# Library

Library provides [actor][actor model] based concurrency primitives for managing effects. Design is heavily inpsired by [Elm Task][] & [Elm Process][] _(which provide [Erlang style concurrency][] in typed language)_ and [Rust `std::thread`][rust_threading] system.

## Design

Library uses [cooperative scheduler][] to run concurrent **tasks** _(a.k.a light-weight processes)_ represented via **synchronous** [generators][]. Tasks describe asynchronous operations that may fail, using (synchronous looking) [delimited continuations][]. That is, instead of `await`-ing on a result of async operation, you delegate via `yield*` _(delegating expression)_, which allows scheduler to suspend execution until (async) result is ready and resume task with a value or a thrown exeception.

```ts
import * as Task from "actor"

/**
 * @param {URL} url
 */
function* work(url) {
  // Task.wait will suspend execution until provided promise is settled,
  // resuming it either with a resolved value or throwing an expection.
  const response = yield* Task.wait(fetch(url.href))
  const content = yield* Task.wait(response.text())

  console.log(content)
}

// Spawns a new task and runs it to completition
Task.spawn(work(new URL("https://gozala.io/work/")))
```

`Task.wait` is just a helper function included with a library designed to look and behave like familiar `await`. It is not special however, it just utilizes two **control** instruction messages that can be used to obtain reference to `current` task so it can be resumed on external event after `suspend` instruction tells scheduler to task switch up until furter notice. To illustrate here is how `Task.sleep` is implemented in the library

```js
/**
 * @param {number} duration
 * @returns {Task.Task<void, never>}
 */
export function* sleep(duration) {
  // obtain reference to the current task handle
  const current = yield* Task.current()
  // set a timer to resume this task after given duratino
  const id = setTimeout(() => Task.resume(current), duration)
  // suspend this task up until timer resumes it.
  try {
    yield* Task.suspend()
    // clear timeout in case task is cancelled in the meantime
  } finally {
    clearTimeout(id)
  }
}
```

> `Task.current()` and `Task.suspend()` are just utility functions that send above mentioned control instructions represented via privade symbols.

### Type Safety

Library is strongly typed and desigend such that [typescript][] is able to infer types of things that computation will resume with (that is things on the left side of `yield*`).

Additionally it's typed such to help you catch common pitfalls like forgettingn `*` at the end of `yield` (which is very different operation) or when yielding generator function e.g. `yield* work` as opposed to a generator, that is `yield* work()`

## API

### `Task<T, X, M>`

Task represents a unit of computation that runs concurrently, a light-weight process (in Erlang terms). You can spawn bunch of them and provided cooperative scheduler will interleave their execution.

Tasks have three type variables:

- Variable `T` describes return type of succeful computation.
- Variable `X` describes error type of failed computation (type of thrown exceptions)
- Variable `M` describes type of a messages this task may produce.

> Please note that that TS does not really support exception type checking so `X` is not guaranteed. Yet, we find them to be more practical than treating them as `any` like TS does on `Promise`s. This allows combinators to restrict on type of task they work with.

##### `fork<T, M, X>(task:Task<T, M, X>):Fork<T, X, M>`

Creates a new concurrent task. It is a primary way to activate a task from the outside of context and usually is how you'd start your main task. It returns `Fork<T, X, M>` that implements `Future<T, X>` interface, which is like a lazy promise `Promise<T>` so it's result can be `await`-ed.

```js
// arbitrary program
export const entry = async () => {
  // Creates a main task and await for it's result
  const result = await Task.fork(main)
  // prints 0
  console.log(result)
}

function* main() {
  console.log("main task is activated")
  // your main task
  return 0
}
```

You can start new concurrent tasks from other tasks. Note that forked task is detached from from the task that starts it. Fork may outlive it and may fail without affecting that task that started it.

```js
function* main() {
  const worker = yield* Task.fork(work())
  console.log("prints first")
}

function* work() {
  console.log("prints second")
}
```

##### `join<T, M, X>(fork:Fork<T, M, X>): Task<T, M, X>`

When task forks it gets a reference to a `Fork<T, X, M>` instance, which can be used to `join` forked task back in. Task that executes `join` gets suspended
until fork is done executing at which point it is resumed with a return value of the forked task. If forked task throws executing `join` will throw that error out. All the messages from the forked task will propagate through
the task it is joined with.

> You can think of it as fork having it's own `stdout` / `stderr`, but when joined its `stdout` / `stderror` get piped into caller task's `stdout` / `stderr`.

```js
function* main() {
  // Start a concurrent task doing some work
  const worker = yield* Task.fork(work())
  // Concurrently perfrom some other worke in the main task
  yield* doSomeOtherWork()
  try {
    // Now join worker task back in and get it's return value
    const value = yield* Task.join(worker)
    // ...
  } catch (error) {
    // If worker crashed it's error is caught here.
  }
}
```

##### `abort<T, M, X>(fork:Fork<T, M, X>, error:X):Task<void, never, never>`

Forked task may be aborted by another task if it has a reference to it.

```js
function* main() {
  const worker = yield* Task.fork(work())
  yield* Task.sleep(10)
  yield* Task.abort(worker, new Error("die"))
}

function* work() {
  const session = new AbortController()
  try {
    const response = yield* Task.wait(fetch(URL, session))
    const text = yield* Task.wait(response.text())
    // ...
    localStorage.workStatus = "done"
  } catch (error) {
    if (error.message === "die") {
      // do some clenup logic here
      localStorage.workStatus = "aborted"
    }
  } finally {
    session.abort()
  }
}
```

##### `exit<T, X, M>(fork:Fork<T, X, M>, value:T):Task<void, never, never>`

Forked task may be exited by another task if it has a referce to it.

```ts
function* main() {
  const worker = yield* Task.fork(work())
  const result = yield* doSomethingConcurrently()
  // Exit task here in case we''re finished
  yield* Task.exit(worker, result)
}
```

##### `spawn(task:Task<void, never, never>):Task<void, never>`

Starts concurrent "detached" task. This is a more lightweight alternative to `fork` however only tasks that produce no output (return vaule is `undefined`, can not fail and sends no messages) can be spawned. This invariant is enforced through type system and is in place because spawned tasks (unlike forked ones)
can not be `join`ed, `abort`ed or `exit`ed and there for their errors would end up unhandled.

> Please note: `Task.spawn(work())` does not start a task, it creates one, which if executed will spawn provided task. Unlike `Task.fork` it does not implement `Future<T, X>` interface so awaiting on it will have no effect.

```js
function* main() {
  yield* Task.spawn(work())
  const response = yield* Task.wait(fetch(URL))
  // ...
}

function* work() {
  try {
    // your logic here
  } catch (error) {
    // not allowed to error so you must handle all the errors
  }
}
```

##### `main(task: Task<void, never, never>): void`

Executes a task that produces no output. This is a more light-weight alternative to `Task.fork` for start a main task from the outside. Just like
`Task.spawn` provided `task` is not allowed to fail, or send messages and it's return value is `void` which is enforced by type system.

> Please note: While library will do it's best to infer the error types based on tasks you'll be runnig from it. However due to typescript limitations it can not be guaranteed that is because if you `throw new Error()` that is not inferred by type checker.
>
> It is authors responsibility to provide type annotations for errors.

```js
function* main {
  try {
    // your programs main loop
    while (true) {

    }
  } catch(error) {
    // not allowed to throw so either recorver or exit
  }
}

Task.main(main())
```

### `Task<T, X>`

More commonly tasks describe asynchronous operations that may fail, like HTTP request or write to a database. These tasks do not produce any messages which is why they are typed as `Task<T, X>`.

These category of tasks seem similar to promises, however there is fundamental difference. `Task` represents anynchronous operation as opposed to resulf of an inflight operation like `Promise`. This subtle difference implies that while tasks describe effects, performing and orchestrating is done elsewhere (usually by central disptach system). This ofter referred to as **managed effects**, as opposed to **side effects** and such systems can usually avoid pitfalls of concurrent code by managing all effects in on place.

##### `current<T, M, X>(): Task<Controller<T, X, M>, never>`

Gets a controller of the currently running task. Controller is usually obtained when task needs to "suspend" execution until some outside event occurs. When that event occurs obtained controller can be used to resume tasks execution (see `suspend` code example for more details)

##### `suspend(): Task<void, never>`

Suspends the current task, which can later be resumed from another task that hase it's controller or more often from outside event (e.g. `setTimeout` callback) by calling `Task.resume(controller)`.

> Note: This task never fails, although it may never resume either. However you can utilize `finally` block to do a necessary cleanup in case execution is aborted or cancelled.

```js
function* sleep(duration) {
  // get a reference to the currently running task, so we can resume it.
  const controller = yield* Task.current()
  // resume this task when timeout fires
  const id = setTimeout(() => Task.resume(controller), duration)
  try {
    // suspend this task nothing below this line will run until task is
    // resumed.
    yield* Task.suspend()
  } finally {
    // if task is aborted finally block will still run which given you
    // chance to cleanup.
    clearTimeout(id)
  }
}
```

##### `sleep(duration?: number): Task<void, never>`

Suspends execution for the given duration (in milliseconds), after which
execution is resumed (unless task is cancelled in the meantime).

```js
function* work() {
  console.log("I'm going to take small nap")
  yield* sleep(200)
  console.log("I am back to work")
}
```

##### `wait<T, X = unknown>(input: PromiseLike<T>|T): Task<T, X>`

Provides equivalent of `await` in async functions. Specifically it takes a value that you can await on (that is `Promise<T>|T`) and suspends execution until promise is settled. If promise succeeds execution is resumed with `T` otherwise an error of type `X` is thrown (which is by default unknown since promises do not encode error type).

It is especially useful when you need to deal with **sometimes async** set of operations without having to check if thing is a promise at each step.

```js
function* fetchJSON(url, options) {
  const response = yield* wait(fetch(url, options))
  const json = yield* wait(response.json())
  return json
}
```

> Please note: This that execution is suspended even if passed value is not a promise, however scheduler will still resume it in the same tick of the event loop after, after processing other scheduled tasks. This avoids problematic race condititions that can otherwise occur when values are sometimes promises and other times are not.

##### `all<T, X>(tasks: Iterable<Task<T, X>>): Task<T[], X>`

Takes iterable of tasks and runs them concurrently, returning an array of results in the same order as provided tasks (not in the order of completion). If any of the tasks fail all other tasks are aborted and error is throw into calling task.

> This is basically equivalent of `Promise.all` except cancelation logic because tasks unlike promises can be cancelled.

### `Effect<M>`

Effect is anoter `Task` variant which instead of describing asynchronous operations that may succeed or fail describe asynchronous operations that may cause cascade of events and are there for typed as `Task<void, never, M>`

Effects are often comprised of multiple `Task` and represents either chain of events or type of events that may occur as result of execution.

In both voriants they represent finite set of events and have completion. In that regard (especially first variant) they are more comparable to `Stream` than to an `EventEmitter`. In second variant `M` is ofter a union type which makes them more comparable to `EventEmitter`. Please note that it is best to avoid conceptualzing them thorugh mentioned, imperfect analogies, they are meant to emphasize difference more than similarity.

##### `send<T>(message: T): Effect<T>`

Creates an effect that sends given message (or rather an effect producing given event).

```js
function* work(url) {
  try {
    const response = yield* Task.wait(fetch(url))
    const value = yield* Task.wait(response.json())
    yield* Task.send({ ok:true value })
  } catch (error) {
    yield* Task.send({ ok: false, error })
  }
}
```

##### `effect<T>(task: Task<T, never>): Effect<T>`

Turns a task (that never fails or sends messages) into an effect of it's
result.

##### `listen<T, M>(source:{[K in T]: Effect<M>}): Task.Effect<{type:N, [K in T]: M}>`

Takes several effects and merges them into a single effect of tagged variants so
that their origin could be identified via `type` field.

```js
listen({
  read: effect(dbRead),
  write: effect(dbWrite),
})
```

##### `none():Task.Effect<never>`

Returns empty `Effect`, that is produces no messages. Kind of like `[]` or `""`, which is useful when you need to interact with an API that tases `Effect`, but in your case you produce `none`.


[actor model]: https://en.wikipedia.org/wiki/Actor_model
[elm task]: https://package.elm-lang.org/packages/elm/core/latest/Task
[elm process]: https://package.elm-lang.org/packages/elm/core/latest/Process
[erlang style concurrency]: https://www.erlang.org/doc/getting_started/conc_prog.html
[rust_threading]: https://doc.rust-lang.org/std/thread/index.html
[cooperative scheduler]: https://en.wikipedia.org/wiki/Cooperative_multitasking
[generators]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator
[delimited continuations]: https://en.wikipedia.org/wiki/Delimited_continuation
[typescript]: https://www.typescriptlang.org/
