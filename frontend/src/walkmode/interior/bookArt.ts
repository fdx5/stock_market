/* Each page's picture, directed: where it happens and who is in it (the first is the one the page
 * is about, drawn largest, in front; a "~" before an emoji turns it to face left). BookReader paints
 * the scene and sets the cast in it, moving gently. */

export type ArtScene = "hanok" | "room" | "palace" | "castle" | "ballroom" | "forest" | "mountain" | "field" | "night" | "sea" | "under" | "river" | "snow" | "sky" | "meadow" | "town" | "office" | "market" | "cave";
/** [scene, cast] per page */
export const BOOK_ART: Record<string, [ArtScene, string][]> = {
  heungbu: [["hanok", "🧑‍🌾 😠 🏠"], ["mountain", "🧑‍🌾 👩 👧 👦 🛖"], ["hanok", "🐦 🧑‍🌾 🪹"], ["sky", "🐦 🌰 🧑‍🌾"], ["hanok", "🎃 🎃 🧑‍🌾 👩"], ["hanok", "🎃 🍚 💰 🧑‍🌾"], ["hanok", "😠 💢 🏡"], ["hanok", "😠 🐦 🪹"], ["hanok", "👹 😱 🎃 👺"], ["hanok", "🧑‍🌾 ~😢 🤝"]],
  sunmoon: [["mountain", "👩 👦 👧 🛖"], ["mountain", "🐯 👩 🍡"], ["night", "🐯 👚 🛖"], ["room", "👦 👧 🐾"], ["night", "👦 👧 🌳 🐯"], ["night", "👦 ~🐯 🫙"], ["night", "👧 🪓 ~🐯"], ["night", "👦 👧 🙏 🪢"], ["night", "~🐯 🪢 🌾"], ["sky", "☀️ 🌙 👦 👧"]],
  tortoise: [["meadow", "🐇 🦊 🐿️ 🦔"], ["meadow", "🐇 ~🐢"], ["meadow", "🐢 🐇 🐦"], ["meadow", "🦊 🐇 🐢 🏁"], ["meadow", "🐇 💨 🐢"], ["forest", "🐇 💤 🌳"], ["meadow", "🐢 💦 🌼"], ["meadow", "🐢 🐇 💤 🐿️"], ["meadow", "🐢 🏁 🎉 🦊"], ["meadow", "🐇 😳 🐢 🤝"]],
  kongjwi: [["hanok", "👧 👩‍🦳 👧"], ["field", "👧 🪨 🌾"], ["field", "🐂 👧 ⛏️"], ["hanok", "👧 🏺 💧"], ["hanok", "🐸 🏺 👧"], ["hanok", "👧 🌾 🧵"], ["hanok", "🐦 🐦 🧚 👘 👡"], ["river", "👧 👡 🤴"], ["hanok", "🤴 👡 👧 😲"], ["palace", "👧 🤴 💐 🎎"]],
  rabbitliver: [["under", "🐉 🤒 🧑‍⚕️ 🐠"], ["under", "🐢 🐉 🐡 🦑"], ["mountain", "🐢 🐇 🌿"], ["sea", "🐇 🐢 🌊"], ["under", "🐇 🦀 ⛓️ 🐉"], ["under", "🐇 💡 🐉"], ["sea", "🐢 🐇 🏖️"], ["sea", "🐇 😝 ~🐢"], ["sea", "🐢 😢 🌊"], ["under", "🐉 💊 🐢 ✨"]],
  woodcutter: [["mountain", "🧑‍🌾 👵 🪓 🛖"], ["forest", "🦌 🧑‍🌾 🏹"], ["forest", "🦌 🧑‍🌾 🌕"], ["night", "🧚 🧚 💦 👘"], ["hanok", "🧑‍🌾 🧚 👶 👶"], ["hanok", "🧚 👘 🧑‍🌾 😟"], ["sky", "🧚 👶 👶 ☁️"], ["sky", "🧑‍🌾 🪣 ☁️ 🦌"], ["sky", "🧑‍🌾 🧚 👶 👶 🏯"], ["hanok", "🧑‍🌾 🐎 👵 💧"]],
  lump: [["hanok", "👴 🎵 😊 👨‍🌾"], ["night", "👴 🛖 🌳"], ["night", "👹 👺 👴 🎵"], ["night", "👹 💰 👴 ✨"], ["hanok", "😠 👴 💭"], ["night", "😠 🙉 👹"], ["night", "👹 💢 😠"], ["night", "👹 😠 ~👺"], ["hanok", "😭 😠 🏠"], ["hanok", "👴 😊 💖 🎵"]],
  axe: [["river", "🧑‍🌾 🪓 💦"], ["river", "🧙 ✨ 🪓 🧑‍🌾"], ["river", "🧑‍🌾 🙅 🧙 🥈"], ["river", "🧑‍🌾 😊 🪓 🧙"], ["river", "🧙 🪓 🥇 🥈 🧑‍🌾"], ["river", "😠 🪓 💦 😭"], ["river", "😠 🤩 🧙 🥇"], ["river", "🧙 💢 😱"], ["forest", "😭 🤷 🌳"], ["forest", "🧑‍🌾 🥇 🥈 🪓 ✨"]],
  magpie: [["mountain", "🧑‍🎓 🎒 🌲"], ["forest", "🐍 🐦‍⬛ 🪹 🧑‍🎓 🏹"], ["night", "👩 🛖 🧑‍🎓 🍚"], ["night", "🐍 🧑‍🎓 😱"], ["night", "🐍 🔔 ⛩️"], ["night", "🧑‍🎓 🙏 🌕"], ["night", "🔔 🐦‍⬛ 🐦‍⬛ ⛩️"], ["mountain", "🧑‍🎓 🐦‍⬛ 🔔 ⛩️"], ["mountain", "🧑‍🎓 🪦 🌸"], ["palace", "🧑‍🎓 📜 🐦‍⬛ 🎉"]],
  brothers: [["hanok", "👨 👦 🤝 🏠"], ["field", "👨 👦 🌾 ☀️"], ["night", "👨 🌾 🌕"], ["night", "👦 🌾 🌕"], ["field", "👨 🤔 🌾"], ["night", "👨 🌾 👦 🌾"], ["night", "👨 ~👦 🌕 🌾"], ["night", "👨 👦 🤗 🌾"], ["hanok", "👨‍🌾 👩 😢 👏"], ["field", "👨 👦 👨‍👩‍👧 🍚"]],
  redbean: [["field", "👵 🐯 🫘"], ["field", "👵 🐯 🥣 🌾"], ["room", "👵 😢 🌰 🥣"], ["room", "🌰 🔥 👵"], ["room", "🐢 📍 💩 🧺 🪵 👵"], ["night", "🐯 🔥 🌰"], ["room", "🐯 🐢 💩 😵"], ["room", "🐯 📍 🧺 🪵"], ["river", "🪵 🐯 🌊 👏"], ["room", "👵 🥣 🌰 🐢 😊"]],
  cinderella: [["town", "👧 🧹 👩 👩 👩"], ["castle", "👑 💌 👩 👩"], ["room", "👧 😢 🧚 ✨"], ["room", "🧚 🎃 🐭 🐴 ✨"], ["night", "👸 🎃 🐴 🕛"], ["ballroom", "👸 🤴 💃 🎻"], ["ballroom", "🕛 👸 👠 🏃"], ["town", "🤴 👠 👩 😣"], ["room", "👸 👠 🤴 😲"], ["castle", "👸 🤴 💒 🕊️"]],
  snowwhite: [["castle", "👸 ❄️ 🍒 👑"], ["castle", "👸‍♀️ 🪞 😠"], ["forest", "🏹 👸 🌲"], ["forest", "👸 🧔 🧔 🧔 🛖"], ["forest", "🧙‍♀️ 🍎 🛖"], ["forest", "👸 🍎 💤 🧙‍♀️"], ["forest", "🧔 🧔 😭 ⚰️"], ["forest", "🤴 🐴 👸 ⚰️"], ["forest", "👸 🤴 🧔 🧔 🎉"], ["castle", "👸 🤴 💒 🕊️"]],
  hansel: [["forest", "👦 👧 🧔 🪓 🛖"], ["night", "👦 🪨 ✨ 🌕"], ["night", "👦 👧 🪨 🛖"], ["forest", "👦 🍞 🐦 🐦"], ["forest", "👦 👧 🍭 🍬 🏠"], ["forest", "🧙‍♀️ 👦 ⛓️ 👧"], ["room", "🧙‍♀️ 🦴 👦"], ["room", "👧 🔥 🧙‍♀️"], ["room", "👧 🔥 🧙‍♀️ 💥"], ["forest", "👦 👧 💎 🧔 🛖"]],
  redhood: [["town", "👧 👩 🧺 🍞"], ["forest", "👧 🧺 🌲"], ["forest", "🐺 👧 🧺"], ["meadow", "👧 🌸 🌼 🐺"], ["room", "🐺 🛏️ 👵"], ["room", "👧 🐺 🛏️ 👂"], ["room", "🐺 😱 👧"], ["room", "🏹 🐺 👵 👧"], ["forest", "🐺 🪨 😵"], ["room", "👧 👵 🏹 🍞 😊"]],
  duckling: [["river", "🦆 🥚 🐣 🐥"], ["meadow", "🦆 🐔 🦃 🐥 😢"], ["river", "🐥 😢 🌾"], ["sky", "🦢 🦢 🦢 🐥"], ["snow", "🐥 🧊 🧑‍🌾"], ["snow", "🐥 🐈 😿 🌨️"], ["meadow", "🦢 💪 🌸"], ["river", "🦢 🦢 😟"], ["river", "🦢 🪞 ✨"], ["river", "🦢 🦢 🦢 💖"]],
  mermaid: [["under", "🧜‍♀️ 🐠 🐚 🏰"], ["sea", "🧜‍♀️ 🚢 🤴 🎆"], ["sea", "🧜‍♀️ 🤴 ⛈️ 🌊"], ["under", "🧜‍♀️ 🧙‍♀️ 🦵 🐙"], ["sea", "👸 🤴 🏖️"], ["castle", "👸 🤴 💃"], ["castle", "🤴 👸 💍 😢"], ["sea", "🧜‍♀️ 🧜‍♀️ 🗡️ 👸"], ["sea", "🫧 🫧 🌅 👸"], ["sky", "🧚 ☁️ 🌬️ ✨"]],
  matches: [["snow", "👧 🔥 ❄️ 🏘️"], ["snow", "👧 🧍 🧍 ❄️"], ["snow", "👧 🔥 🧱"], ["snow", "👧 🔥 🔥"], ["snow", "👧 🍗 🍽️ 🔥"], ["night", "🎄 ✨ 👧 🔥"], ["night", "⭐ 💫 👧"], ["night", "👵 ✨ 👧"], ["night", "👵 👧 🔥 ✨ ✨"], ["town", "🤝 🍞 🧣 👧"]],
  emperor: [["castle", "🤴 👔 👗 🪞"], ["castle", "🤴 🕵️ 🕵️ 🧵"], ["castle", "🕵️ 🧶 💰 🕵️"], ["castle", "🧓 😰 🕵️ 🧶"], ["castle", "🤴 😳 🕵️ 🧶"], ["castle", "🤴 🩲 🕵️ 🪞"], ["town", "🤴 🩲 🧍 🧍 👏"], ["town", "👦 🗣️ 🤴 🩲"], ["town", "🤴 😳 🧍 😂 😂"], ["town", "👦 💡 🤴 😅"]],
  piglets: [["meadow", "🐖 🐷 🐷 🐷"], ["meadow", "🐷 🌾 🐷 🪵"], ["meadow", "🐷 🧱 💦 🐷"], ["meadow", "🐺 💨 🌾 🐷"], ["meadow", "🐺 💨 🪵 🐷 🐷"], ["meadow", "🐺 💨 🧱 🐷 🐷 🐷"], ["meadow", "🐺 🏠 🐷 🔥"], ["meadow", "🐺 🔥 💥 🐷"], ["meadow", "🐷 🐷 🐷 🧱 🤝"], ["meadow", "🐷 🐷 🐷 🏠 🎉"]],
  bremen: [["field", "🫏 🧑‍🌾 😢"], ["field", "🫏 🐕 🎶"], ["field", "🫏 🐕 🐈 🐓"], ["night", "🫏 🐕 🐈 🐓 🏠"], ["night", "🐓 🐈 🐕 🫏"], ["night", "🫏 🐕 🐈 🐓 🦹 🦹"], ["room", "🫏 🐕 🐈 🐓 🍗 💤"], ["night", "🐈 🐕 🫏 🐓 🦹"], ["forest", "🦹 😱 🦹 🦹"], ["room", "🫏 🐕 🐈 🐓 🎺 🎶"]],
  pinocchio: [["room", "👴 🪵 🪆 ✨"], ["room", "👴 🪆 📚 🧥"], ["town", "🪆 🎭 🎟️"], ["room", "🪆 🧚 👃"], ["room", "🧚 🐦 🪆"], ["town", "🪆 🎠 🫏 🫏"], ["sea", "🪆 🐋 🌊"], ["under", "🐋 👴 🪆 🕯️"], ["sea", "🪆 👴 🐋 🌊"], ["room", "👦 👴 🧚 ✨"]],
  gulliver: [["sea", "⛵ ⛈️ 🌊 🧔"], ["sea", "🧔 🧍 🧍 🧍 🪢"], ["castle", "🧔 🛒 🧍 👑"], ["castle", "🧔 🍞 🧒 🧍"], ["sea", "🧔 ⛵ ⛵ ⛵ 🪢"], ["castle", "🧔 🚣 🧍 😠"], ["field", "🗿 🗿 🧔 🌾"], ["room", "👧 📦 🧔 🪰"], ["sky", "🦅 📦 🌊"], ["town", "🧔 🏠 🌍 💭"]],
  alice: [["meadow", "👧 🐇 ⏰ 👩"], ["cave", "👧 🕳️ 🚪"], ["room", "👧 🍾 🍰 🚪"], ["sea", "👧 💧 🐭 🦤"], ["forest", "🐛 🍄 👧"], ["forest", "😸 🌳 👧"], ["meadow", "🎩 🐇 ☕ 🫖 👧"], ["castle", "👸 🃏 🃏 🌹 👧"], ["castle", "👧 🃏 👸 ⚖️"], ["meadow", "👧 💤 👩 🃏"]],
  oz: [["field", "👧 🐶 🌪️ 🏠"], ["meadow", "👧 🧚‍♀️ 👠 🏠"], ["field", "👧 🐶 🌾 🛤️"], ["forest", "👧 🤖 🛢️ 🌾"], ["forest", "🦁 👧 🤖 🌾 🐶"], ["castle", "💚 🏰 👧 🦁 🤖"], ["castle", "👧 🪣 🧙‍♀️ 💦"], ["castle", "🧓 🎈 👧 🦁 🤖"], ["meadow", "🌾 🤖 🦁 💖 🧠"], ["field", "👧 🐶 🏠 👠 ✨"]],
  traderjoe: [["office", "🧑‍💼 💻 🤖 ❓"], ["office", "🧑‍💼 📋 ⚖️ 🔒"], ["office", "📈 🧑‍💼"], ["office", "📊 🧑‍💼"], ["office", "🤖 🤖 📉"], ["office", "📝 🔐 🧑‍💼"], ["market", "🧑‍💼 🛒 💹"], ["office", "🗂️ 🧑‍💼"], ["office", "🧑‍💼 🤖 🤖 📜 🐞"], ["office", "🧑‍💼 📏 ✅ 📚"]],
};
