(function() {
  /* vim:set ts=2 sw=2 sts=2 et autoread */
  'use strict';  var ACTIVE, Actor, Deferred, INACTIVE, STOP, When, spawn, _ref;
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };
  _ref = require('q'), When = _ref.when, Deferred = _ref.defer;
  ACTIVE = {
    valueOf: function() {
      return 'Active';
    }
  };
  INACTIVE = {
    valueOf: function() {
      return 'Inactive';
    }
  };
  STOP = {
    valueOf: function() {
      return 'StopActor';
    }
  };
  spawn = exports.spawn = function(reactor) {
    var actor;
    actor = new Actor(reactor);
    return actor.start.apply(actor, arguments.slice(1));
  };
  exports.Actor = Actor = (function() {
    Actor.prototype._state = INACTIVE;
    Actor.prototype._inbox = null;
    Actor.prototype._outbox = null;
    function Actor(act) {
      this.raise = __bind(this.raise, this);;
      this.react = __bind(this.react, this);;      this.act = act;
    }
    Actor.prototype.start = function() {
      if (this._state === INACTIVE) {
        this._state = ACTIVE;
        this._inbox = {};
        this._outbox = {};
        this._reactor = this.act.apply(this, arguments);
        this.react();
      }
      return this;
    };
    Actor.prototype.stop = function() {
      if (this._state === ACTIVE) {
        return this.react(STOP);
      }
    };
    Actor.prototype.restart = function() {
      this.stop();
      return this.start.apply(this, arguments);
    };
    Actor.prototype.send = function(type, message) {
      var mailbox, ticket, _ref, _ref2;
      ticket = (_ref = this._inbox[type]) != null ? _ref.shift() : void 0;
      if (ticket) {
        ticket.resolve(message);
      } else {
        mailbox = (_ref2 = this._outbox[type]) != null ? _ref2 : this._outbox[type] = [];
        mailbox.push(message);
      }
      return this;
    };
    Actor.prototype.receive = function(type) {
      var mailbox, message, ticket, _ref, _ref2;
      message = (_ref = this._outbox[type]) != null ? _ref.shift() : void 0;
      if (!message) {
        mailbox = (_ref2 = this._inbox[type]) != null ? _ref2 : this._inbox[type] = [];
        mailbox.push(ticket = Deferred());
        message = ticket.promise;
      }
      return message;
    };
    Actor.prototype.react = function(message) {
      if (message === STOP) {
        this.raise(StopIteration);
      } else if (this._state === ACTIVE) {
        try {
          When(this._reactor.send(message), this.react, this.raise);
        } catch (exception) {
          if (exception === StopIteration) {
            this.reset();
          } else {
            throw exception;
          }
        }
      }
      return this;
    };
    Actor.prototype.raise = function(exception) {
      return this._reactor["throw"](exception);
    };
    Actor.prototype.reset = function() {
      this._state = INACTIVE;
      this._inbox = this._outbox = this._reactor = null;
      return this;
    };
    return Actor;
  })();
}).call(this);
