// index.js — Arabic + per-guild config + robust register flow + review channel + admin actions + Sheets sync

const {
  Client,
  GatewayIntentBits,
  Collection,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  StringSelectMenuBuilder,
} = require("discord.js");
const fs = require("fs");
require("dotenv").config();

// Base/global config (fallback defaults)
const baseConfig = require("./config.json");
// Per-guild config accessors
const GC = require("./guildConfig");

// Role permissions map
const permsMap = require("./permissions.json");

// Google Sheets sync (service account)
const Sheets = require("./sheets"); // make sure sheets.js exists as provided

// ----------------------------------------------------------------------------
// Client & commands
// ----------------------------------------------------------------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
client.commands = new Collection();

// Load slash commands from ./commands
for (const file of fs.readdirSync("./commands").filter((f) => f.endsWith(".js"))) {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const command = require(`./commands/${file}`);
  if (command?.data?.name) client.commands.set(command.data.name, command);
}

client.once("ready", async () => {
  console.log(`تم التشغيل بنجاح: ${client.user.tag}`);

  // Optional one-time full sync: set SHEETS_SYNC_ON_START=true in secrets to run it once
  if (process.env.SHEETS_SYNC_ON_START === "true") {
    try {
      const all = loadUsers();
      for (const uid of Object.keys(all)) {
        const u = await client.users.fetch(uid).catch(() => null);
        if (u) all[uid].tag = u.tag;
      }
      await Sheets.syncUsers(all);
      console.log("[sheets] initial sync done.");
    } catch (e) {
      console.error("[sheets] initial sync failed:", e);
    }
  }
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function gconf(guildId) {
  // Per-guild config merging base defaults
  const g = GC.get(guildId || "");
  // Merge base defaults (currency, fees, ranks, etc.) with saved per-guild IDs
  return {
    ...baseConfig,
    ...g,
    // Ensure essential defaults exist
    CURRENCY_SYMBOL: g.CURRENCY_SYMBOL || baseConfig.CURRENCY_SYMBOL || "$",
    MIN_DEPOSIT: g.MIN_DEPOSIT ?? baseConfig.MIN_DEPOSIT ?? 0,
    ranks: g.ranks || baseConfig.ranks || ["Bronze", "Silver", "Gold"],
    fees: g.fees || baseConfig.fees || { DEPOSIT_FEE: 0, TRANSFER_FEE: 0, WITHDRAW_FEE: 0 },
  };
}

function ensureDir(pathLike) {
  const dir = pathLike.split("/").slice(0, -1).join("/");
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadUsers() {
  ensureDir("./database/users.json");
  if (!fs.existsSync("./database/users.json")) fs.writeFileSync("./database/users.json", "{}");
  return JSON.parse(fs.readFileSync("./database/users.json", "utf8"));
}

function saveUsers(users) {
  ensureDir("./database/users.json");
  fs.writeFileSync("./database/users.json", JSON.stringify(users, null, 2));
}

function hasAnyRoleId(member, ids = []) {
  return !!ids?.length && member.roles.cache.some((r) => ids.includes(r.id));
}

function hasPermission(member, actionKey, guildId) {
  const g = gconf(guildId);
  const adminRoleId = g.ADMIN_ROLE_ID;
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    (adminRoleId && member.roles.cache.has(adminRoleId)) ||
    hasAnyRoleId(member, permsMap[actionKey] || [])
  );
}

function canOpenAdminPanel(member, guildId) {
  const keys = Object.keys(permsMap);
  const g = gconf(guildId);
  const adminRoleId = g.ADMIN_ROLE_ID;
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    (adminRoleId && member.roles.cache.has(adminRoleId)) ||
    keys.some((k) => hasPermission(member, k, guildId))
  );
}

async function pushLog(guildId, msg) {
  try {
    const g = gconf(guildId);
    const LOG_CH_ID = g.ADMIN_LOG_CHANNEL_ID || baseConfig.ADMIN_LOG_CHANNEL_ID;
    if (!LOG_CH_ID) return;
    const ch =
      client.channels.cache.get(LOG_CH_ID) ||
      (await client.channels.fetch(LOG_CH_ID).catch(() => null));
    if (ch) ch.send(String(msg));
  } catch (e) {
    console.error("pushLog error:", e);
  }
}

// ----------------------------------------------------------------------------
// Registration flow (modal -> الحالة/الفصيل -> finalize)
// ----------------------------------------------------------------------------
/** regDraft[userId] = { name,country,age,birth,income, kind?, faction? } */
const regDraft = new Map();

async function finalizeRegistration(interaction, draft) {
  try {
    const gid = interaction.guildId;
    const g = gconf(gid);

    if (!draft?.kind) {
      return interaction.reply?.({ content: "الرجاء اختيار الحالة.", ephemeral: true });
    }
    if (draft.kind === "فصيل" && !draft.faction) {
      return interaction.reply?.({ content: "اختر الفصيل قبل الإرسال.", ephemeral: true });
    }

    const U = loadUsers();
    const id = interaction.user.id;
    const existing = U[id];
    if (existing && existing.status !== "rejected") {
      let reason = "لديك طلب حاليًا.";
      if (existing.status === "pending") reason = "طلبك قيد المراجعة بالفعل.";
      else if (existing.status === "approved") reason = "لديك حساب مفعل بالفعل.";
      else if (existing.status === "blacklisted") reason = "تم إدراجك في القائمة السوداء. تواصل مع الإدارة.";
      return interaction.reply?.({ content: `لا يمكن إرسال طلب جديد: **${reason}**`, ephemeral: true });
    }

    const nowIso = new Date().toISOString();
    U[id] = {
      name: draft.name,
      country: draft.country,
      age: draft.age,
      birth: draft.birth,
      income: draft.income,
      rank: existing?.rank || g.ranks?.[0] || "Bronze",
      balance: existing?.balance ?? 0,
      status: "pending",
      kind: draft.kind,
      faction: draft.kind === "فصيل" ? (draft.faction || "غير محدد") : null,
      created_at: existing?.created_at || nowIso,
      updated_at: nowIso,
    };
    saveUsers(U);

    // Mirror to Google Sheets
    await Sheets.upsertUser(id, U[id], interaction.user.tag);

    // Confirm to user (ephemeral) and remove interactive rows if applicable
    if (interaction.isAnySelectMenu?.() || interaction.isButton?.()) {
      await interaction.update({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", components: [] });
    } else if (!interaction.replied) {
      await interaction.reply({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", ephemeral: true });
    }

    // Emit review card for this guild (we pass guildId to handler)
    client.emit("userRegistered", {
      id,
      mention: `<@${id}>`,
      tag: interaction.user.tag,
      avatar: interaction.user.displayAvatarURL({ size: 256 }),
      name: draft.name,
      country: draft.country,
      age: draft.age,
      birth: draft.birth,
      income: draft.income,
      status: "pending",
      kind: draft.kind,
      faction: draft.kind === "فصيل" ? (draft.faction || "غير محدد") : null,
    }, gid);

    regDraft.delete(id);
  } catch (e) {
    console.error("finalizeRegistration error:", e);
    if (!interaction.replied) {
      await interaction.reply({ content: "حدث خطأ أثناء إرسال الطلب.", ephemeral: true });
    }
  }
}

// ----------------------------------------------------------------------------
// Interactions
// ----------------------------------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  try {
    const gid = interaction.guildId;
    const g = gconf(gid);

    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "admin" && !canOpenAdminPanel(interaction.member, gid)) {
        return interaction.reply({ content: "لا تملك صلاحية فتح لوحة الإدارة.", ephemeral: true });
      }
      const command = client.commands.get(interaction.commandName);
      if (command) {
        // Provide both per-guild config accessor and helpers
        const context = {
          gconf,                       // function (guildId) => merged config
          cfg: () => gconf(gid),       // backwards-compat
          users: loadUsers,
          saveUsers,
        };
        await command.execute(interaction, context);
      }
      return;
    }

    // ===== POST-MODAL selects/buttons for registration =====

    // الحالة select → if "فصيل" show faction select; otherwise finalize immediately
    if (interaction.isStringSelectMenu() && interaction.customId === "reg_status_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.kind = interaction.values?.[0];
      regDraft.set(interaction.user.id, d);

      // Keep submit row if present (fallback)
      const current = interaction.message.components || [];
      const submitRow = current.find(r => r.components?.some(c => c.customId === "reg_submit_after"));

      if (d.kind === "فصيل") {
        const factionRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("reg_faction_after")
            .setPlaceholder("اختر الفصيل")
            .addOptions(
              { label: "شرطة", value: "شرطة" },
              { label: "جيش", value: "جيش" },
              { label: "طب", value: "طب" }
            )
        );
        const rows = [factionRow];
        if (submitRow) rows.push(submitRow);
        // Remove الحالة row by not re-adding it
        return interaction.update({ components: rows });
      }

      return finalizeRegistration(interaction, d);
    }

    // الفصيل select → finalize immediately after a choice
    if (interaction.isStringSelectMenu() && interaction.customId === "reg_faction_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.faction = interaction.values?.[0] || null;
      regDraft.set(interaction.user.id, d);
      return finalizeRegistration(interaction, d);
    }

    // Manual submit fallback (if someone clicks it)
    if (interaction.isButton() && interaction.customId === "reg_submit_after") {
      const d = regDraft.get(interaction.user.id);
      if (!d) {
        return interaction.reply({
          content: "انتهت الجلسة أو البيانات غير موجودة. أعد تشغيل /register.",
          ephemeral: true,
        });
      }
      return finalizeRegistration(interaction, d);
    }

    // ===== Admin buttons (approve / reject / others) =====
    if (interaction.isButton()) {
      const users = loadUsers();
      const [action, userId, extra] = interaction.customId.split("_");

      if (action === "approve" || action === "reject") {
        const permKey = action === "approve" ? "approve" : "reject";
        if (!hasPermission(interaction.member, permKey, gid)) {
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        }
        const user = users[userId];
        if (!user) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        if (user.status !== "pending") {
          return interaction.reply({
            content: `لا يمكن تنفيذ هذا الإجراء لأن حالة الحساب الحالية هي **${user.status}**.`,
            ephemeral: true,
          });
        }

        const approved = action === "approve";
        user.status = approved ? "approved" : "rejected";
        user.updated_at = new Date().toISOString();
        saveUsers(users);

        // Mirror to Sheets (status + ensure row)
        await Sheets.updateStatus(userId, user.status);
        await Sheets.upsertUser(userId, user, null);

        await pushLog(gid, `${approved ? "✅" : "⛔"} ${interaction.user.username} ${approved ? "قبل" : "رفض"} حساب <@${userId}>`);

        // If action happened inside REVIEW channel: edit that card only (do NOT delete other cards)
        if (interaction.channelId === (g.ADMIN_CHANNEL_ID || baseConfig.ADMIN_CHANNEL_ID)) {
          return interaction.update({
            content: `${approved ? "✅" : "⛔"} تم ${approved ? "قبول" : "رفض"} طلب فتح الحساب لـ ${user.name} (${userId})`,
            components: [],
          });
        }

        // If done elsewhere (e.g., admin panel), just confirm
        return interaction.reply({ content: `${approved ? "تم القبول." : "تم الرفض."}`, ephemeral: true });
      }

      if (action === "blacklist") {
        if (!hasPermission(interaction.member, "blacklist", gid))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const u = users[userId];
        if (!u) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        u.status = "blacklisted";
        u.updated_at = new Date().toISOString();
        saveUsers(users);

        await Sheets.updateStatus(userId, "blacklisted");
        await Sheets.upsertUser(userId, u, null);

        return interaction.reply({ content: `🚫 تم إضافة <@${userId}> إلى القائمة السوداء.`, ephemeral: true });
      }

      if (action === "promote") {
        if (!hasPermission(interaction.member, "promote", gid))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });

        const ranks = g.ranks || baseConfig.ranks || ["Bronze", "Silver", "Gold"];
        const row = new ActionRowBuilder().addComponents(
          ranks.map((r) =>
            new ButtonBuilder().setCustomId(`setrank_${userId}_${r}`).setLabel(r).setStyle(ButtonStyle.Secondary)
          )
        );
        return interaction.reply({
          content: `اختر الرتبة الجديدة لـ <@${userId}>:`,
          components: [row],
          ephemeral: true,
        });
      }

      if (action === "setrank") {
        if (!hasPermission(interaction.member, "promote", gid))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const u = users[userId];
        if (!u) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        u.rank = extra;
        u.updated_at = new Date().toISOString();
        saveUsers(users);
        await Sheets.upsertUser(userId, u, null);
        return interaction.update({ content: `📈 تم تحديث رتبة <@${userId}> إلى **${extra}**`, components: [] });
      }

      if (action === "addBalance") {
        if (!hasPermission(interaction.member, "addBalance", gid))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`addBalanceModal_${userId}`).setTitle("إضافة رصيد");
        const amountInput = new TextInputBuilder()
          .setCustomId("amount")
          .setLabel(`المبلغ (${g.CURRENCY_SYMBOL || baseConfig.CURRENCY_SYMBOL || "$"})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        return interaction.showModal(modal);
      }

      if (action === "freeze" || action === "unfreeze") {
        if (!hasPermission(interaction.member, "freeze", gid))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const u = users[userId];
        if (!u) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        u.frozen = action === "freeze";
        u.updated_at = new Date().toISOString();
        saveUsers(users);
        await Sheets.upsertUser(userId, u, null);
        return interaction.reply({
          content: `تم ${action === "freeze" ? "تجميد" : "إلغاء تجميد"} حساب <@${userId}>.`,
          ephemeral: true,
        });
      }

      if (action === "fees") {
        if (!hasPermission(interaction.member, "editFee", gid))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const modal = new ModalBuilder().setCustomId("feesModal").setTitle("تعديل الرسوم البنكية");
        const dep = new TextInputBuilder().setCustomId("deposit").setLabel("رسوم الإيداع %").setStyle(TextInputStyle.Short).setRequired(true);
        const trn = new TextInputBuilder().setCustomId("transfer").setLabel("رسوم التحويل %").setStyle(TextInputStyle.Short).setRequired(true);
        const wdr = new TextInputBuilder().setCustomId("withdraw").setLabel("رسوم السحب %").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(dep),
          new ActionRowBuilder().addComponents(trn),
          new ActionRowBuilder().addComponents(wdr)
        );
        return interaction.showModal(modal);
      }
    }

    // AddBalance modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith("addBalanceModal_")) {
      const gid2 = interaction.guildId;
      if (!hasPermission(interaction.member, "addBalance", gid2))
        return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });

      const userId = interaction.customId.split("_")[1];
      const users = loadUsers();
      const u = users[userId];
      if (!u) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });

      const amount = parseFloat(interaction.fields.getTextInputValue("amount"));
      if (isNaN(amount) || amount <= 0) return interaction.reply({ content: "رجاءً أدخل مبلغًا صالحًا أكبر من 0.", ephemeral: true });

      u.balance = (u.balance || 0) + amount;
      u.updated_at = new Date().toISOString();
      saveUsers(users);

      await Sheets.updateBalance(userId, u.balance);
      await Sheets.upsertUser(userId, u, null);

      return interaction.reply({ content: `✅ تم إضافة ${amount}${g.CURRENCY_SYMBOL || "$"} إلى <@${userId}>`, ephemeral: true });
    }

    // Fees modal
    if (interaction.isModalSubmit() && interaction.customId === "feesModal") {
      const gid2 = interaction.guildId;
      if (!hasPermission(interaction.member, "editFee", gid2))
        return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });

      try {
        const dep = Number(interaction.fields.getTextInputValue("deposit"));
        const trn = Number(interaction.fields.getTextInputValue("transfer"));
        const wdr = Number(interaction.fields.getTextInputValue("withdraw"));
        for (const v of [dep, trn, wdr]) {
          if (!Number.isFinite(v) || v < 0 || v > 100) {
            return interaction.reply({ content: "يجب أن تكون الرسوم بين 0 و 100.", ephemeral: true });
          }
        }
        // Update global fees in config.json (simple global approach)
        baseConfig.fees = { DEPOSIT_FEE: dep, TRANSFER_FEE: trn, WITHDRAW_FEE: wdr };
        fs.writeFileSync("./config.json", JSON.stringify(baseConfig, null, 2));
        await interaction.reply({ content: `تم تحديث الرسوم: إيداع ${dep}% • تحويل ${trn}% • سحب ${wdr}%`, ephemeral: true });
      } catch (e) {
        console.error("فشل تحديث الرسوم:", e);
        if (!interaction.replied) return interaction.reply({ content: "حدث خطأ أثناء تحديث الرسوم.", ephemeral: true });
      }
    }

    // Register modal → collect base data then ask for الحالة (and maybe فصيل)
    if (interaction.isModalSubmit() && interaction.customId === "registerModal") {
      if (g.REGISTER_CHANNEL_ID && interaction.channelId !== g.REGISTER_CHANNEL_ID) {
        return interaction.reply({ content: `يمكن إرسال طلب التسجيل فقط من داخل <#${g.REGISTER_CHANNEL_ID}>.`, ephemeral: true });
      }
      try {
        const name = interaction.fields.getTextInputValue("name").trim();
        const country = interaction.fields.getTextInputValue("country").trim();
        const age = parseInt(interaction.fields.getTextInputValue("age").trim(), 10);
        const birth = interaction.fields.getTextInputValue("birth").trim();
        const income = parseInt(interaction.fields.getTextInputValue("income").trim(), 10);

        if (!name || !country || !Number.isFinite(age) || age < 16 || age > 65 ||
            !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birth) || !Number.isFinite(income) || income <= 0) {
          return interaction.reply({ content: "رجاءً أدخل بيانات تسجيل صحيحة.", ephemeral: true });
        }
        if (income < (g.MIN_DEPOSIT || 0)) {
          return interaction.reply({ content: `الحد الأدنى للدخل هو ${g.MIN_DEPOSIT} ${g.CURRENCY_SYMBOL}.`, ephemeral: true });
        }

        // Stash draft
        regDraft.set(interaction.user.id, { name, country, age, birth, income });

        // الحالة select + fallback submit button
        const statusSelect = new StringSelectMenuBuilder()
          .setCustomId("reg_status_after")
          .setPlaceholder("اختر الحالة")
          .addOptions(
            { label: "مدني", value: "مدني" },
            { label: "عصابة", value: "عصابة" },
            { label: "فصيل", value: "فصيل" }
          );
        const confirmBtn = new ButtonBuilder().setCustomId("reg_submit_after").setLabel("إرسال الطلب").setStyle(ButtonStyle.Primary);

        const row1 = new ActionRowBuilder().addComponents(statusSelect);
        const row2 = new ActionRowBuilder().addComponents(confirmBtn);

        return interaction.reply({
          content: "📋 تم استلام النموذج. اختر **الحالة**.\nإذا اخترت **فصيل** سيظهر اختيار الفصيل، وبعدها سيتم الإرسال تلقائيًا.",
          components: [row1, row2],
          ephemeral: true,
        });
      } catch (e) {
        console.error("registerModal error:", e);
        if (!interaction.replied) return interaction.reply({ content: "فشل التسجيل.", ephemeral: true });
      }
    }
  } catch (err) {
    console.error("خطأ في التفاعل:", err);
  }
});

// ----------------------------------------------------------------------------
// Review card sender (does NOT delete previous messages)
// ----------------------------------------------------------------------------
client.on("userRegistered", async (user, guildId) => {
  try {
    const g = gconf(guildId);
    const REVIEW_ID = g.ADMIN_CHANNEL_ID || baseConfig.ADMIN_CHANNEL_ID;
    if (!REVIEW_ID) {
      await pushLog(guildId, "⚠️ لم أستطع إيجاد قناة المراجعة. اضبطها عبر /setup.");
      return;
    }

    const reviewChannel =
      client.channels.cache.get(REVIEW_ID) ||
      (await client.channels.fetch?.(REVIEW_ID).catch(() => null));

    if (!reviewChannel) {
      await pushLog(guildId, `⚠️ قناة المراجعة غير موجودة (ID: ${REVIEW_ID}).`);
      return;
    }

    if (
      ![
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.GuildAnnouncement,
      ].includes(reviewChannel.type)
    ) {
      await pushLog(guildId, `⚠️ القناة (${REVIEW_ID}) ليست قناة نصية صالحة للإرسال.`);
      return;
    }

    const me = reviewChannel.guild?.members?.me;
    const perms = me ? reviewChannel.permissionsFor(me) : null;
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
      await pushLog(guildId, "⚠️ لا أملك صلاحية عرض/إرسال في قناة المراجعة.");
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("طلب تسجيل جديد ✏️")
      .setThumbnail(user.avatar)
      .setDescription(`**مستخدم جديد:** ${user.mention}`)
      .addFields(
        { name: "الاسم", value: String(user.name || "—"), inline: true },
        { name: "البلد", value: String(user.country || "—"), inline: true },
        { name: "العمر", value: String(user.age ?? "—"), inline: true },
        { name: "تاريخ الميلاد", value: String(user.birth || "—"), inline: true },
        { name: "الدخل الشهري", value: `${user.income ?? 0} ${g.CURRENCY_SYMBOL || baseConfig.CURRENCY_SYMBOL || "$"}`, inline: true },
        { name: "الحالة", value: String(user.kind || "مدني"), inline: true },
        { name: "الفصيل", value: String(user.faction || "—"), inline: true },
        { name: "ID", value: String(user.id), inline: false }
      )
      .setFooter({ text: "يرجى مراجعة الطلب والقبول/الرفض." });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve_${user.id}`).setLabel("موافقة").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject_${user.id}`).setLabel("رفض").setStyle(ButtonStyle.Danger)
    );

    await reviewChannel.send({ embeds: [embed], components: [row] });
    console.log("[review] card sent for", user.id);
  } catch (e) {
    console.error("userRegistered send error:", e);
  }
});

// ----------------------------------------------------------------------------
client.login(process.env.TOKEN);
