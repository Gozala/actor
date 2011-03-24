/* vim:set ts=2 sw=2 sts=2 et autoread
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
*/
'use strict';var ACTIVE, Actor, Deferred, INACTIVE, STOP, When, spawn, _ref;
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
    this.react = __bind(this.react, this);;    this.act = act;
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
  Actor.prototype.send = function(message) {
    var mailbox, ticket, _ref, _ref2;
    ticket = (_ref = this._inbox[message.type]) != null ? _ref.shift() : void 0;
    if (ticket) {
      ticket.resolve(message);
    } else {
      mailbox = (_ref2 = this._outbox[message.type]) != null ? _ref2 : this._outbox[message.type] = [];
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