/*! ko.i18n.js | Knockout i18n module. */

;(function () {
  if (!window.ko) throw new Error('Translation requires knockout.')

  // private observable
  var _bundles = ko.observable({})

  ko.i18n = {
    locale: ko.observable('en'),

    // Sets language bundle under specified locale
    setBundle: function (locale, bundle) {
      var value = _bundles()

      value[locale] = bundle

      _bundles(value)
    },

    // Sets multiple bundles with the key as locales
    setBundles: function (bundles) {
      var value = _bundles()

      Object.keys(bundles).forEach(function (locale) {
        value[locale] = bundles[locale]
      })

      _bundles(value)
    },
  }

  ko.bindingHandlers.i18n = {
    translate: function (tokens, localize, value) {
      var newValue = value
      for (var key in tokens) {
        if (tokens.hasOwnProperty(key)) {
          var innerValue = ko.unwrap(tokens[key])
          if (localize) {
            innerValue = getBundleValue(innerValue)
          }
          newValue = newValue.replace('{{' + key + '}}', innerValue)
        }
      }
      return newValue
    },
    translateTerms: function (value) {
      var newValue = value
      var embedsDone = false
      var iter = 10
      var r = /(?<token>\[\[(?<name>\w+)(?::(?<cap>cap))?\]\])/
      while (!embedsDone && iter > 0) {
        var match = r.exec(newValue)
        if (!match || match.length == 0) {
          embedsDone = true
        } else {
          var replacement = getBundleValue(match.groups.name)
          if (match.groups.cap) {
            replacement =
              replacement[0].toUpperCase() +
              (replacement.length > 1 ? replacement.substring(1) : '')
          }

          if (!String.prototype.replaceAll) {
            String.prototype.replaceAll = function (str, newStr) {
              // If a regex pattern
              if (Object.prototype.toString.call(str).toLowerCase() === '[object regexp]') {
                return this.replace(str, newStr)
              }

              // If a string
              function escapeForRegExp(str) {
                return str.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') // (A)
              }
              return this.replace(new RegExp(escapeForRegExp(str), 'g'), newStr)
            }
          }
          newValue = newValue.replaceAll(match.groups.token, replacement)
        }
        iter--
      }
      return newValue
    },
    update: function (elm, valueAccessor, bindings) {
      var value = ko.unwrap(valueAccessor())
      // , bundle = bundles()[ko.i18n.locale()] || {};

      if (typeof value == 'string') {
        value = { $: value }
      }

      Object.keys(value).forEach(function (attr) {
        var _value = getBundleValue(value[attr])

        _value = ko.bindingHandlers.i18n.translateTerms(_value)

        // todo; check if there are dynamic substitutes in bindings
        if (bindings.has('i18n-options')) {
          var substitutes = bindings.get('i18n-options') || {}
          _value = ko.bindingHandlers.i18n.translate(substitutes, false, _value)
        }

        if (bindings.has('i18n-localizedTokens')) {
          var substitutes = bindings.get('i18n-localizedTokens') || {}
          _value = ko.bindingHandlers.i18n.translate(substitutes, true, _value)
          _value = ko.bindingHandlers.i18n.translateTerms(_value)
        }

        if (bindings.has('i18n-embeds')) {
          var embeds = bindings.get('i18n-embeds') || {}
          for (var key in embeds) {
            if (!embeds.hasOwnProperty(key)) continue
            var embed = embeds[key]
            if (!embed.hasOwnProperty('el')) {
              throw new Error("i18n-embeds item with no 'el' element name at key " + key)
            }
            var element = document.createElement(embed.el)
            for (var embedAttr in embed) {
              if (!embed.hasOwnProperty(embedAttr)) continue
              if (embedAttr == 'el' || embedAttr == 'inner') continue
              element.setAttribute(embedAttr, embed[embedAttr])
            }
            if (embed.hasOwnProperty('inner')) {
              element.innerHTML = getBundleValue(embed.inner)
            }
            _value = _value.replace('{{' + key + '}}', element.outerHTML)
          }
        }

        if (attr == '$') {
          elm.innerHTML = _value
        } else {
          elm.setAttribute(attr, _value)
        }
      })
    },
  }

  function getBundleValue(key) {
    var locales = ko.i18n.locale(),
      value = _bundles()

    if (!Array.isArray(locales)) {
      locales = [locales]
    }

    return (
      locales.reduce(function (result, locale) {
        return result || (value[locale] || {})[key]
      }, undefined) || key
    )
  }
})()
