### vim:set ts=2 sw=2 sts=2 et autoread
 * ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Jetpack.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Irakli Gozalishvili <gozala@mozilla.com> (Original Author)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK *****
###

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
  # @param {Object} message
  #   Object representing a message sent to the generator. Object may
  #   have `type` string property that is used to categorize a messages.
  #   Generator itself will be able to receive a message by calling `receive`
  #   method with a `type` argument.
  send: (message) ->
    # If there is a ticket for a given message type in `inbox` resolving it
    # with a given `message`. Otherwise putting message to `outbox`.
    ticket = @_inbox[message.type]?.shift()
    if ticket
      ticket.resolve message
    else
      # Adding a `message` to a mailbox for a given message `type`.
      mailbox = @_outbox[message.type] ? @_outbox[message.type] = []
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
