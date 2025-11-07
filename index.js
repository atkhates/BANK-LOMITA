// index.js — Arabic + robust register flow + review channel + admin actions + TX channel

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

// global defaults (still used as fallback)
const {
  ADMIN_CHANNEL_ID,
  ADMIN_LOG_CHANNEL_ID,
  ADMIN_ROLE_ID,
  CURRENCY_SYMBOL,
} = require("./config.json");

const permsMap = require("./permissions.json");
const GC = require("./guildConfig");

// Optional Google Sheets module (safe if missing)
let Sheets = null;
try { Sheets = require("./sheets"); } catch { Sheets = { syncUsers: async () => {} }; }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.commands = new Collection();

/* ============ Load slash commands ============ */
for (const file of fs.readdirSync("./commands").filter((f) => f.endsWith(".js"))) {
  const command = require(`./commands/${file}`);
  if (command?.data?.name) client.commands.set(command.data.name, command);
}

client.once("ready", () => {
  console.log(`تم التشغيل بنجاح: ${client.user.tag}`);
});

/* ===================== Helpers ===================== */
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
  Promise.resolve(Sheets.syncUsers(users)).catch((e) => console.error("Sheet sync error:", e));
}
function cfg() {
  delete require.cache[require.resolve("./config.json")];
  return require("./config.json");
}
function hasAnyRoleId(member, ids = []) {
  return !!ids?.length && member.roles.cache.some((r) => ids.includes(r.id));
}
function hasPermission(member, actionKey) {
  const g = GC.get(member.guild.id);
  const adminRole = g.ADMIN_ROLE_ID || ADMIN_ROLE_ID;
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    (adminRole && member.roles.cache.has(adminRole)) ||
    hasAnyRoleId(member, permsMap[actionKey] || [])
  );
}
function canOpenAdminPanel(member) {
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    (GC.get(member.guild.id).ADMIN_ROLE_ID || ADMIN_ROLE_ID) && member.roles.cache.has(GC.get(member.guild.id).ADMIN_ROLE_ID || ADMIN_ROLE_ID) ||
    Object.keys(permsMap).some((k) => hasPermission(member, k))
  );
}
async function pushLog(msg) {
  try {
    const g = GC.get(client.guilds.cache.first()?.id || "");
    const logId = g.ADMIN_LOG_CHANNEL_ID || ADMIN_LOG_CHANNEL_ID;
    if (!logId) return;
    const ch =
      client.channels.cache.get(logId) ||
      (await client.channels.fetch(logId).catch(() => null));
    if (ch) ch.send(String(msg));
  } catch (e) {
    console.error("pushLog error:", e);
  }
}

/* ====== Transactions helper: persist + post to TX channel ====== */
function appendTx(entry) {
  try {
    ensureDir("./database/transactions.json");
    if (!fs.existsSync("./database/transactions.json")) fs.writeFileSync("./database/transactions.json", "[]");
    const arr = JSON.parse(fs.readFileSync("./database/transactions.json", "utf8"));
    arr.push({ ts: new Date().toISOString(), ...entry });
    fs.writeFileSync("./database/transactions.json", JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error("tx persist error:", e);
  }
}
async function postTx(guildId, entry) {
  appendTx(entry);

  const g = GC.get(guildId);
  const chId = g.TX_CHANNEL_ID;
  if (!chId) return;

  const ch =
    client.channels.cache.get(chId) ||
    (await client.channels.fetch(chId).catch(() => null));
  if (!ch) return;

  const sym = cfg().CURRENCY_SYMBOL || CURRENCY_SYMBOL || "$";
  const embed = new EmbedBuilder()
    .setColor(entry.type === "addBalance" ? 0x57f287 : 0x5865f2)
    .setTitle(entry.type === "addBalance" ? "إضافة رصيد" : "تحويل رصيد")
    .addFields(
      ...(entry.type === "addBalance"
        ? [
            { name: "المسؤول", value: `<@${entry.by}>`, inline: true },
            { name: "إلى", value: `<@${entry.to}>`, inline: true },
          ]
        : [
            { name: "من", value: `<@${entry.from}>`, inline: true },
            { name: "إلى", value: `<@${entry.to}>`, inline: true },
            { name: "الرسوم", value: `${entry.fee} ${sym}`, inline: true },
          ]),
      { name: "المبلغ", value: `${entry.amount} ${sym}`, inline: true },
      { name: "الوقت", value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true }
    );

  ch.send({ embeds: [embed] }).catch(() => {});
}

/* ========= temp storage for register flow ========= */
const regDraft = new Map();

/* ===== finalize registration ===== */
async function finalizeRegistration(interaction, draft) {
  try {
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

    const conf = cfg();
    U[id] = {
      name: draft.name,
      country: draft.country,
      age: draft.age,
      birth: draft.birth,
      income: draft.income,
      rank: existing?.rank || conf.ranks?.[0] || "Bronze",
      balance: existing?.balance ?? 0,
      status: "pending",
      kind: draft.kind,
      faction: draft.kind === "فصيل" ? (draft.faction || "غير محدد") : null,
    };
    saveUsers(U);

    if (interaction.isAnySelectMenu?.() || interaction.isButton?.()) {
      await interaction.update({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", components: [] });
    } else if (!interaction.replied) {
      await interaction.reply({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", ephemeral: true });
    }

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
    /* ---- Slash commands ---- */
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "admin" && !canOpenAdminPanel(interaction.member)) {
        return interaction.reply({ content: "لا تملك صلاحية فتح لوحة الإدارة.", ephemeral: true });
      }
      const command = client.commands.get(interaction.commandName);
      if (command) {
        // pass both cfg() + per-guild getter gconf, plus postTx for /transfer
        const context = {
          cfg,
          gconf: (gid) => GC.get(gid),
          users: loadUsers,
          saveUsers,
          postTx,
        };
        await command.execute(interaction, context);
      }
      return;
    }

    /* ====== Register selections ====== */
    if (interaction.isStringSelectMenu() && interaction.customId === "reg_status_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.kind = interaction.values?.[0];
      regDraft.set(interaction.user.id, d);

      const current = interaction.message.components || [];
      const submitRow = current.find(r =>
        r.components?.some(c => c.customId === "reg_submit_after")
      );

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
        return interaction.update({ components: rows });
      }
      return finalizeRegistration(interaction, d);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "reg_faction_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.faction = interaction.values?.[0] || null;
      regDraft.set(interaction.user.id, d);
      return finalizeRegistration(interaction, d);
    }

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

    /* ---- Admin buttons ---- */
    if (interaction.isButton()) {
      const users = loadUsers();
      const [action, userId, extra] = interaction.customId.split("_");

      if (action === "approve" || action === "reject") {
        const permKey = action === "approve" ? "approve" : "reject";
        if (!hasPermission(interaction.member, permKey)) {
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
        saveUsers(users);

        await pushLog(`${approved ? "✅" : "⛔"} ${interaction.user.username} ${approved ? "قبل" : "رفض"} حساب <@${userId}>`);

        const reviewId = GC.get(interaction.guildId).ADMIN_CHANNEL_ID || ADMIN_CHANNEL_ID;
        if (interaction.channelId === reviewId) {
          await interaction.update({
            content: `${approved ? "✅" : "⛔"} تم ${approved ? "قبول" : "رفض"} طلب فتح الحساب لـ ${user.name} (${userId})`,
            components: [],
          });
          try {
            const messages = await interaction.channel.messages.fetch({ limit: 10 });
            const onlyBot = messages.filter((m) => m.author.id === client.user.id);
            if (onlyBot.size > 1) {
              const arr = Array.from(onlyBot.values());
              for (let i = 0; i < arr.length - 1; i++) arr[i].delete().catch(() => {});
            }
          } catch {}
        } else {
          await interaction.reply({ content: `${approved ? "تم القبول." : "تم الرفض."}`, ephemeral: true });
        }
        return;
      }

      if (action === "blacklist") {
        if (!hasPermission(interaction.member, "blacklist"))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const user = users[userId];
        if (!user) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        user.status = "blacklisted";
        saveUsers(users);
        return interaction.reply({ content: `🚫 تم إضافة <@${userId}> إلى القائمة السوداء.`, ephemeral: true });
      }

      if (action === "promote") {
        if (!hasPermission(interaction.member, "promote"))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });

        const { ranks } = cfg();
        const rankRow = new ActionRowBuilder().addComponents(
          ranks.map((rankName) =>
            new ButtonBuilder()
              .setCustomId(`setrank_${userId}_${rankName}`)
              .setLabel(rankName)
              .setStyle(ButtonStyle.Secondary)
          )
        );
        return interaction.reply({
          content: `اختر الرتبة الجديدة لـ <@${userId}>:`,
          components: [rankRow],
          ephemeral: true,
        });
      }

      if (action === "setrank") {
        if (!hasPermission(interaction.member, "promote"))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const user = users[userId];
        if (!user) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        user.rank = extra;
        saveUsers(users);
        return interaction.update({ content: `📈 تم تحديث رتبة <@${userId}> إلى **${extra}**`, components: [] });
      }

      if (action === "freeze" || action === "unfreeze") {
        if (!hasPermission(interaction.member, "freeze"))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const user = users[userId];
        if (!user) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        user.frozen = action === "freeze";
        saveUsers(users);
        return interaction.reply({ content: `تم ${action === "freeze" ? "تجميد" : "إلغاء تجميد"} حساب <@${userId}>.`, ephemeral: true });
      }

      if (action === "addBalance") {
        if (!hasPermission(interaction.member, "addBalance"))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`addBalanceModal_${userId}`).setTitle("إضافة رصيد");
        const amountInput = new TextInputBuilder()
          .setCustomId("amount")
          .setLabel(`المبلغ (${CURRENCY_SYMBOL})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        return interaction.showModal(modal);
      }

      if (action === "fees") {
        if (!hasPermission(interaction.member, "editFee"))
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
      if (!hasPermission(interaction.member, "addBalance"))
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

      // announce to TX channel
      await postTx(interaction.guildId, {
        type: "addBalance",
        by: interaction.user.id,
        to: userId,
        amount,
      });

      return interaction.reply({ content: `✅ تم إضافة ${amount}${CURRENCY_SYMBOL} إلى <@${userId}>`, ephemeral: true });
    }

    /* ---- Fees modal ---- */
    if (interaction.isModalSubmit() && interaction.customId === "feesModal") {
      if (!hasPermission(interaction.member, "editFee"))
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
        const conf = cfg();
        conf.fees = { DEPOSIT_FEE: dep, TRANSFER_FEE: trn, WITHDRAW_FEE: wdr };
        fs.writeFileSync("./config.json", JSON.stringify(conf, null, 2));
        return interaction.reply({ content: `تم تحديث الرسوم: إيداع ${dep}% • تحويل ${trn}% • سحب ${wdr}%`, ephemeral: true });
      } catch (e) {
        console.error("فشل تحديث الرسوم:", e);
        if (!interaction.replied) return interaction.reply({ content: "حدث خطأ أثناء تحديث الرسوم.", ephemeral: true });
      }
    }

    /* ---- Register modal ---- */
    if (interaction.isModalSubmit() && interaction.customId === "registerModal") {
      const g = GC.get(interaction.guildId);
      const allowed = g.REGISTER_CHANNEL_ID || cfg().REGISTER_CHANNEL_ID || null;
      if (allowed && interaction.channelId !== allowed) {
        return interaction.reply({ content: `يمكن إرسال طلب التسجيل فقط من داخل <#${allowed}>.`, ephemeral: true });
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
        const minimum = (g.MIN_DEPOSIT ?? cfg().MIN_DEPOSIT) || 0;
        if (income < minimum) {
          return interaction.reply({ content: `الحد الأدنى للدخل هو ${minimum} ${cfg().CURRENCY_SYMBOL}.`, ephemeral: true });
        }

        regDraft.set(interaction.user.id, { name, country, age, birth, income });

        const statusSelect = new StringSelectMenuBuilder()
          .setCustomId("reg_status_after")
          .setPlaceholder("اختر الحالة")
          .addOptions(
            { label: "مدني", value: "مدني" },
            { label: "عصابة", value: "عصابة" },
            { label: "فصيل", value: "فصيل" }
          );

        const confirmBtn = new ButtonBuilder()
          .setCustomId("reg_submit_after")
          .setLabel("إرسال الطلب")
          .setStyle(ButtonStyle.Primary);

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

/* ===== review card on register ===== */
client.on("userRegistered", async (user) => {
  try {
    const g = GC.get(client.guilds.cache.first()?.id || "");
    const reviewId = g.ADMIN_CHANNEL_ID || ADMIN_CHANNEL_ID;
    const reviewChannel =
      client.channels.cache.get(reviewId) ||
      (await client.channels.fetch?.(reviewId).catch(() => null));
    if (!reviewChannel) {
      console.warn("[review] channel not found", reviewId);
      await pushLog(`⚠️ لم أستطع إيجاد قناة المراجعة (ID: ${reviewId}).`);
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
      await pushLog(`⚠️ القناة (${reviewId}) ليست قناة نصية صالحة للإرسال.`);
      return;
    }

    const me = reviewChannel.guild?.members?.me;
    const perms = me ? reviewChannel.permissionsFor(me) : null;
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
      await pushLog("⚠️ لا أملك صلاحية عرض/إرسال في قناة المراجعة.");
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
        { name: "الدخل الشهري", value: `${user.income ?? 0} ${CURRENCY_SYMBOL}`, inline: true },
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
  } catch (e) {
    console.error("userRegistered send error:", e);
  }
});

client.login(process.env.TOKEN);
