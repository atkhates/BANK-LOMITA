// index.js — Arabic bank bot core (per-guild config, register -> review, admin actions)

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
const path = require("path");
require("dotenv").config();

const permsMap = require("./permissions.json");
const GC = require("./guildConfig"); // get/set per-guild config (IDs, fees, etc.)

// Optional Google Sheets sync (safe no-op if missing)
let Sheets = null;
try {
  Sheets = require("./sheets"); // must export { syncUsers(usersObj), appendTx(txEntry) } if used
} catch {
  Sheets = { syncUsers: async () => {}, appendTx: async () => {} };
}

/* ===================== Client & Commands ===================== */

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.commands = new Collection();

// Load all /commands/*.js
for (const file of fs.readdirSync("./commands").filter((f) => f.endsWith(".js"))) {
  const command = require(`./commands/${file}`);
  if (command?.data?.name) client.commands.set(command.data.name, command);
}

client.once("ready", () => {
  console.log(`تم التشغيل بنجاح: ${client.user.tag}`);
});

/* ===================== File Helpers ===================== */

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// users.json helpers
function loadUsers() {
  const p = "./database/users.json";
  ensureDir(p);
  if (!fs.existsSync(p)) fs.writeFileSync(p, "{}");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function saveUsers(users) {
  const p = "./database/users.json";
  ensureDir(p);
  fs.writeFileSync(p, JSON.stringify(users, null, 2));
  // optional Google Sheets sync
  Promise.resolve(Sheets.syncUsers(users)).catch((e) => console.error("Sheet sync error:", e));
}

// transactions.json helpers
function ensureFile(filePath) {
  ensureDir(filePath);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "[]");
}
function pushTx(entry) {
  try {
    const txPath = "./database/transactions.json";
    ensureFile(txPath);
    const arr = JSON.parse(fs.readFileSync(txPath, "utf8"));
    const row = { ts: new Date().toISOString(), ...entry };
    arr.push(row);
    fs.writeFileSync(txPath, JSON.stringify(arr, null, 2));
    // optional sheet log
    Promise.resolve(Sheets.appendTx(row)).catch(() => {});
  } catch (e) {
    console.error("pushTx error:", e);
  }
}

/* ===================== Permission Helpers ===================== */

function hasAnyRoleId(member, ids = []) {
  return !!ids?.length && member.roles.cache.some((r) => ids.includes(r.id));
}
function hasPermission(member, actionKey, gconf) {
  // Admin (server admin), configured ADMIN_ROLE_ID, or custom roles in permissions.json[actionKey]
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    (gconf.ADMIN_ROLE_ID && member.roles.cache.has(gconf.ADMIN_ROLE_ID)) ||
    hasAnyRoleId(member, permsMap[actionKey] || [])
  );
}
function canOpenAdminPanel(member, gconf) {
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    (gconf.ADMIN_ROLE_ID && member.roles.cache.has(gconf.ADMIN_ROLE_ID)) ||
    Object.keys(permsMap).some((k) => hasPermission(member, k, gconf))
  );
}

async function pushLogToChannel(client, channelId, msg) {
  try {
    if (!channelId) return;
    const ch = client.channels.cache.get(channelId) || (await client.channels.fetch(channelId).catch(() => null));
    if (ch) ch.send(String(msg));
  } catch (e) {
    console.error("pushLogToChannel error:", e);
  }
}

/* ===================== Register flow state ===================== */

const regDraft = new Map(); // userId -> { name,country,age,birth,income, kind?, faction? }

/* ===================== Finalize registration helper ===================== */

async function finalizeRegistration(interaction, draft) {
  try {
    const gconf = GC.get(interaction.guildId);

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

    U[id] = {
      name: draft.name,
      country: draft.country,
      age: draft.age,
      birth: draft.birth,
      income: draft.income,
      rank: existing?.rank || (gconf.ranks?.[0] || "Bronze"),
      balance: existing?.balance ?? 0,
      status: "pending",
      kind: draft.kind,
      faction: draft.kind === "فصيل" ? (draft.faction || "غير محدد") : null,
      frozen: false,
    };
    saveUsers(U);
    console.log("[register] saved user:", id);

    // Update ephemeral message (remove components)
    if (interaction.isAnySelectMenu?.() || interaction.isButton?.()) {
      await interaction.update({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", components: [] });
    } else if (!interaction.replied) {
      await interaction.reply({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", ephemeral: true });
    }

    // Emit for review channel card
    client.emit("userRegistered", {
      guildId: interaction.guildId,
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
    });

    regDraft.delete(id);
  } catch (e) {
    console.error("finalizeRegistration error:", e);
    if (!interaction.replied) {
      await interaction.reply({ content: "حدث خطأ أثناء إرسال الطلب.", ephemeral: true });
    }
  }
}

/* ===================== Interactions ===================== */

client.on("interactionCreate", async (interaction) => {
  try {
    const gconf = GC.get(interaction.guildId);

    /* ---- Slash commands ---- */
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "admin" && !canOpenAdminPanel(interaction.member, gconf)) {
        return interaction.reply({ content: "لا تملك صلاحية فتح لوحة الإدارة.", ephemeral: true });
      }

      const command = client.commands.get(interaction.commandName);
      if (command) {
        const context = {
          // IMPORTANT: per-guild config getter
          cfg: () => GC.get(interaction.guildId),
          users: loadUsers,
          saveUsers,
          pushTx,
          pushLog: (client_, payload) =>
            pushLogToChannel(client, gconf.ADMIN_LOG_CHANNEL_ID, payload?.msg || payload),
        };
        await command.execute(interaction, context);
      }
      return;
    }

    /* ======== Post-modal flow (الحالة/الفصيل) ======== */

    // Select "الحالة"
    if (interaction.isStringSelectMenu() && interaction.customId === "reg_status_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.kind = interaction.values?.[0];
      regDraft.set(interaction.user.id, d);

      const current = interaction.message.components || [];
      const submitRow = current.find((r) => r.components?.some((c) => c.customId === "reg_submit_after"));

      if (d.kind === "فصيل") {
        const factionRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("reg_faction_after")
            .setPlaceholder("اختر الفصيل")
            .addOptions({ label: "شرطة", value: "شرطة" }, { label: "جيش", value: "جيش" }, { label: "طب", value: "طب" })
        );
        const rows = [factionRow];
        if (submitRow) rows.push(submitRow);
        return interaction.update({ components: rows }); // remove الحالة row
      }

      // Not a faction — finalize immediately
      return finalizeRegistration(interaction, d);
    }

    // Select "الفصيل"
    if (interaction.isStringSelectMenu() && interaction.customId === "reg_faction_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.faction = interaction.values?.[0] || null;
      regDraft.set(interaction.user.id, d);
      return finalizeRegistration(interaction, d);
    }

    // Manual submit fallback
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

    /* ---- Admin buttons (approve/reject/etc.) ---- */
    if (interaction.isButton()) {
      const users = loadUsers();
      const [action, userId, extra] = interaction.customId.split("_");
      const target = users[userId];

      // Approve / Reject
      if (action === "approve" || action === "reject") {
        const permKey = action === "approve" ? "approve" : "reject";
        if (!hasPermission(interaction.member, permKey, gconf)) {
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        }
        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        if (target.status !== "pending") {
          return interaction.reply({
            content: `لا يمكن تنفيذ هذا الإجراء لأن حالة الحساب الحالية هي **${target.status}**.`,
            ephemeral: true,
          });
        }

        const approved = action === "approve";
        target.status = approved ? "approved" : "rejected";
        saveUsers(users);

        await pushLogToChannel(
          client,
          gconf.ADMIN_LOG_CHANNEL_ID,
          `${approved ? "✅" : "⛔"} ${interaction.user.username} ${approved ? "قبل" : "رفض"} حساب <@${userId}>`
        );

        // Keep review card visible (do not delete), just disable buttons
        if (interaction.channelId === gconf.ADMIN_CHANNEL_ID) {
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`approve_${userId}`)
              .setLabel("موافقة")
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`reject_${userId}`)
              .setLabel("رفض")
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true)
          );
          await interaction.update({
            content: `${approved ? "✅" : "⛔"} ${
              approved ? "تم قبول" : "تم رفض"
            } طلب فتح الحساب لـ ${target.name} (${userId})`,
            components: [disabledRow],
          });
        } else {
          await interaction.reply({ content: `${approved ? "تم القبول." : "تم الرفض."}`, ephemeral: true });
        }
        return;
      }

      // Blacklist
      if (action === "blacklist") {
        if (!hasPermission(interaction.member, "blacklist", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        target.status = "blacklisted";
        saveUsers(users);
        return interaction.reply({ content: `🚫 تم إضافة <@${userId}> إلى القائمة السوداء.`, ephemeral: true });
      }

      // Promote (show rank choices from per-guild config)
      if (action === "promote") {
        if (!hasPermission(interaction.member, "promote", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const ranks = gconf.ranks || ["Bronze", "Silver", "Gold"];
        const row = new ActionRowBuilder().addComponents(
          ranks.map((r) =>
            new ButtonBuilder().setCustomId(`setrank_${userId}_${r}`).setLabel(r).setStyle(ButtonStyle.Secondary)
          )
        );
        return interaction.reply({ content: `اختر الرتبة الجديدة لـ <@${userId}>:`, components: [row], ephemeral: true });
      }

      if (action === "setrank") {
        if (!hasPermission(interaction.member, "promote", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        target.rank = extra;
        saveUsers(users);
        return interaction.update({ content: `📈 تم تحديث رتبة <@${userId}> إلى **${extra}**`, components: [] });
      }

      // Add balance (modal)
      if (action === "addBalance") {
        if (!hasPermission(interaction.member, "addBalance", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`addBalanceModal_${userId}`).setTitle("إضافة رصيد");
        const amountInput = new TextInputBuilder()
          .setCustomId("amount")
          .setLabel(`المبلغ (${gconf.CURRENCY_SYMBOL || "$"})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        return interaction.showModal(modal);
      }

      // Freeze / Unfreeze
      if (action === "freeze" || action === "unfreeze") {
        if (!hasPermission(interaction.member, "freeze", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        target.frozen = action === "freeze";
        saveUsers(users);
        return interaction.reply({
          content: `تم ${action === "freeze" ? "تجميد" : "إلغاء تجميد"} حساب <@${userId}>.`,
          ephemeral: true,
        });
      }

      // Edit fees (modal)
      if (action === "fees") {
        if (!hasPermission(interaction.member, "editFee", gconf))
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

    /* ---- Add balance modal submit ---- */
    if (interaction.isModalSubmit() && interaction.customId.startsWith("addBalanceModal_")) {
      const gconfNow = GC.get(interaction.guildId);
      if (!hasPermission(interaction.member, "addBalance", gconfNow))
        return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });

      const userId = interaction.customId.split("_")[1];
      const users = loadUsers();
      const user = users[userId];
      if (!user) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
      const amount = parseFloat(interaction.fields.getTextInputValue("amount"));
      if (isNaN(amount) || amount <= 0)
        return interaction.reply({ content: "رجاءً أدخل مبلغًا صالحًا أكبر من 0.", ephemeral: true });

      user.balance = (user.balance || 0) + amount;
      saveUsers(users);

      pushTx({ type: "admin_add_balance", guildId: interaction.guildId, to: userId, amount });
      await interaction.reply({ content: `✅ تم إضافة ${amount}${gconfNow.CURRENCY_SYMBOL || "$"} إلى <@${userId}>`, ephemeral: true });
      return;
    }

    /* ---- Fees modal submit ---- */
    if (interaction.isModalSubmit() && interaction.customId === "feesModal") {
      const gconfNow = GC.get(interaction.guildId);
      if (!hasPermission(interaction.member, "editFee", gconfNow))
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
        GC.set(interaction.guildId, {
          fees: { DEPOSIT_FEE: dep, TRANSFER_FEE: trn, WITHDRAW_FEE: wdr },
        });
        return interaction.reply({
          content: `تم تحديث الرسوم: إيداع ${dep}% • تحويل ${trn}% • سحب ${wdr}%`,
          ephemeral: true,
        });
      } catch (e) {
        console.error("فشل تحديث الرسوم:", e);
        if (!interaction.replied) return interaction.reply({ content: "حدث خطأ أثناء تحديث الرسوم.", ephemeral: true });
      }
    }

    /* ---- Register modal submit ---- */
    if (interaction.isModalSubmit() && interaction.customId === "registerModal") {
      const gconfNow = GC.get(interaction.guildId);
      if (gconfNow.REGISTER_CHANNEL_ID && interaction.channelId !== gconfNow.REGISTER_CHANNEL_ID) {
        return interaction.reply({
          content: `يمكن إرسال طلب التسجيل فقط من داخل <#${gconfNow.REGISTER_CHANNEL_ID}>.`,
          ephemeral: true,
        });
      }
      try {
        const name = interaction.fields.getTextInputValue("name").trim();
        const country = interaction.fields.getTextInputValue("country").trim();
        const age = parseInt(interaction.fields.getTextInputValue("age").trim(), 10);
        const birth = interaction.fields.getTextInputValue("birth").trim();
        const income = parseInt(interaction.fields.getTextInputValue("income").trim(), 10);

        if (
          !name ||
          !country ||
          !Number.isFinite(age) ||
          age < 16 ||
          age > 65 ||
          !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birth) ||
          !Number.isFinite(income) ||
          income <= 0
        ) {
          return interaction.reply({ content: "رجاءً أدخل بيانات تسجيل صحيحة.", ephemeral: true });
        }
        if (income < (gconfNow.MIN_DEPOSIT || 0)) {
          return interaction.reply({
            content: `الحد الأدنى للدخل هو ${gconfNow.MIN_DEPOSIT} ${gconfNow.CURRENCY_SYMBOL || "$"}.`,
            ephemeral: true,
          });
        }

        regDraft.set(interaction.user.id, { name, country, age, birth, income });

        const statusSelect = new StringSelectMenuBuilder()
          .setCustomId("reg_status_after")
          .setPlaceholder("اختر الحالة")
          .addOptions({ label: "مدني", value: "مدني" }, { label: "عصابة", value: "عصابة" }, { label: "فصيل", value: "فصيل" });

        const confirmBtn = new ButtonBuilder().setCustomId("reg_submit_after").setLabel("إرسال الطلب").setStyle(ButtonStyle.Primary);

        const row1 = new ActionRowBuilder().addComponents(statusSelect);
        const row2 = new ActionRowBuilder().addComponents(confirmBtn);

        return interaction.reply({
          content:
            "📋 تم استلام النموذج. اختر **الحالة**.\nإذا اخترت **فصيل** سيظهر اختيار الفصيل، وبعدها سيتم الإرسال تلقائيًا.",
          components: [row1, row2],
          ephemeral: true,
        });
      } catch (e) {
        console.error("registerModal error:", e);
        if (!interaction.replied) return interaction.reply({ content: "فشل التسجيل.", ephemeral: true });
      }
    }
  } catch (err) {
    console.error("interaction error:", err);
  }
});

/* ===================== Review card sender ===================== */

client.on("userRegistered", async (payload) => {
  try {
    const gconf = GC.get(payload.guildId);
    const reviewChannelId = gconf.ADMIN_CHANNEL_ID;
    if (!reviewChannelId) return;

    const reviewChannel =
      client.channels.cache.get(reviewChannelId) || (await client.channels.fetch?.(reviewChannelId).catch(() => null));
    if (!reviewChannel) {
      await pushLogToChannel(client, gconf.ADMIN_LOG_CHANNEL_ID, `⚠️ قناة المراجعة غير موجودة (ID: ${reviewChannelId}).`);
      return;
    }

    // ensure text-capable and we can send
    if (
      ![
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.GuildAnnouncement,
      ].includes(reviewChannel.type)
    ) {
      await pushLogToChannel(client, gconf.ADMIN_LOG_CHANNEL_ID, `⚠️ القناة (${reviewChannelId}) ليست نصية.`);
      return;
    }
    const me = reviewChannel.guild?.members?.me;
    const perms = me ? reviewChannel.permissionsFor(me) : null;
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
      await pushLogToChannel(client, gconf.ADMIN_LOG_CHANNEL_ID, "⚠️ لا أملك صلاحية عرض/إرسال في قناة المراجعة.");
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("طلب تسجيل جديد ✏️")
      .setThumbnail(payload.avatar)
      .setDescription(`**مستخدم جديد:** ${payload.mention}`)
      .addFields(
        { name: "الاسم", value: String(payload.name || "—"), inline: true },
        { name: "البلد", value: String(payload.country || "—"), inline: true },
        { name: "العمر", value: String(payload.age ?? "—"), inline: true },
        { name: "تاريخ الميلاد", value: String(payload.birth || "—"), inline: true },
        { name: "الدخل الشهري", value: `${payload.income ?? 0} ${gconf.CURRENCY_SYMBOL || "$"}`, inline: true },
        { name: "الحالة", value: String(payload.kind || "مدني"), inline: true },
        { name: "الفصيل", value: String(payload.faction || "—"), inline: true },
        { name: "ID", value: String(payload.id), inline: false }
      )
      .setFooter({ text: "يرجى مراجعة الطلب والقبول/الرفض." });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve_${payload.id}`).setLabel("موافقة").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject_${payload.id}`).setLabel("رفض").setStyle(ButtonStyle.Danger)
    );

    await reviewChannel.send({ embeds: [embed], components: [row] });
    console.log("[review] card sent for", payload.id);
  } catch (e) {
    console.error("userRegistered send error:", e);
  }
});

/* ===================== Login ===================== */

client.login(process.env.TOKEN);
