### vim:set ts=2 sw=2 sts=2 et autoread ###

'use strict'

{ when: When, defer: Deferred } = require 'q'

ACTIVE = valueOf: -> 'Active'
INACTIVE = valueOf: -> 'Inactive'
STOP = valueOf: -> 'StopActor'

# Creates and starts actor.
spawn = exports.spawn = (reactor) ->
  actor = new Actor reactor
  actor.start.apply actor, arguments[1...]

# Function used for creating an actors.
exports.Actor = class Actor
  _state: INACTIVE
  _inbox: null
  _outbox: null
  constructor: (act) -> @act = act

  # Starts this actor.
  # This method is idempotent.
  start: ->
    if @_state is INACTIVE
      # Changing state to active
      @_state = ACTIVE
      # Creating an empty inbox
      @_inbox = {}
      # Creating an empty outbox
      @_outbox = {}
      # Starting a generator and passing all the arguments to it.
      @_reactor = @act.apply @, arguments
      @react()
    @ # Returning this instance for chain-ability.

  # Stops this actor.
  # This method is idempotent.
  stop: ->
    @react(STOP) if @_state is ACTIVE
  
  # Restarts this actor.
  restart: ->
    @stop()                      # Stopping
    @start.apply @, arguments    # Starting

  # Sends `message` to this actor (asynchronous) supplying explicit reply
  # destination.
  # Sends `message` to this actor asynchronously.
  # @param {String} type
  #   Type of message being send.
  # @param {Object} message
  #   Message being send.
  send: (type, message) ->
    # If there is a ticket for a given `type` in `inbox` resolving it
    # with a given `message`. Otherwise putting `message` to `outbox`'s
    # mailbox for the given `type`.
    ticket = @_inbox[type]?.shift()
    if ticket
      ticket.resolve message
    else
      # Adding a `message` to a mailbox for a given message `type`.
      mailbox = @_outbox[type] ? @_outbox[type] = []
      mailbox.push message
    @ # Returning this instance for chain-ability.

  # Receives a message from this actor's mailbox.
  # If message is already present in mailbox it will be immediately
  # returned, if message has not been delivered yet, then promise will
  # be returned which will be fulfilled once message is delivered.
  # @param {String} [type]
  #   Message category, if not given uncategorized message is returned.
  receive: (type) ->
    # Taking a message from an outbox's mailbox for a given message `type`.
    message = @_outbox[type]?.shift()
    # If there is no such message then we create a promise and store it
    # into `inbox`s mailbox for a given type.
    if not message
      mailbox = @_inbox[type] ? @_inbox[type] = []
      mailbox.push ticket = Deferred()
      message = ticket.promise
    message # Finally we return either message or promise of it.

  # Method is used to resume suspended (enclosed) generator with a
  # given `message`. If `message` is a `STOP` constant actor will get
  # deactivated instead.
  # @param {Object|STOP} message
  #   Message to resume generator with or a `STOP` constant to 
  react: (message) =>
    # If generator is still active we resume it when given `message` is
    # resolved. If message is rejected, rejection `reason` exception will
    # be thrown into generator. If generation is no longer active just
    # reseting an `act` variable.
    if message is STOP
      @raise StopIteration
    else if @_state is ACTIVE
      try
        # Whenever value yield by a generator is resolved we execute
        # reactor again. If value got rejected we resume generator with
        # an throw an exception thrown into it.
        When @_reactor.send(message), @react, @raise
      catch exception
        # If generator throws `StopIteration` it means that generator is
        # done with it's work so we deactivate this actor. Otherwise we
        # just re-throw thrown `exception`.
        if exception is StopIteration then @reset()
        else throw exception
    @ # Returning this instance for chain-ability.

  # Method resumes enclosed generator with a given `exceptions` thrown into
  # it.
  # @param {Error|String} exception
  raise: (exception) => @_reactor.throw exception

  # Resets actor to the initial state.
  reset: () ->
    @_state = INACTIVE
    @_inbox = @_outbox = @_reactor = null
    @ # Returning this instance for chain-ability.
