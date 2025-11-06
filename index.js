// index.js — Arabic bank bot: per-guild config, review-only approve/reject

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
  StringSelectMenuBuilder,
} = require("discord.js");
const fs = require("fs");
require("dotenv").config();

const permsMap = require("./permissions.json");
const GC = require("./guildConfig"); // gconf(gid).*

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.commands = new Collection();
// load commands
for (const f of fs.readdirSync("./commands").filter((f) => f.endsWith(".js"))) {
  const c = require(`./commands/${f}`);
  client.commands.set(c.data.name, c);
}

client.once("ready", () => {
  console.log(`✅ تم التشغيل: ${client.user.tag}`);
});

/* -------------------- storage helpers -------------------- */
function ensureDir(p) {
  const dir = p.split("/").slice(0, -1).join("/");
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
function hasPermission(member, actionKey, adminRoleId) {
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    (adminRoleId && member.roles.cache.has(adminRoleId)) ||
    hasAnyRoleId(member, permsMap[actionKey] || [])
  );
}

/* ---------- draft store between modal and final submit ---------- */
const regDraft = new Map(); // userId -> { name,country,age,birth,income, kind?, faction? }

/* ---------------------- finalize registration ---------------------- */
async function finalizeRegistration(interaction, draft) {
  const gid = interaction.guildId;
  const g = GC.get(gid);

  try {
    if (!draft?.kind) return interaction.reply?.({ content: "اختر الحالة أولاً.", ephemeral: true });
    if (draft.kind === "فصيل" && !draft.faction)
      return interaction.reply?.({ content: "اختر الفصيل أولاً.", ephemeral: true });

    const U = loadUsers();
    const id = interaction.user.id;
    const existing = U[id];
    if (existing && existing.status !== "rejected") {
      let reason = "لديك طلب سابق.";
      if (existing.status === "pending") reason = "طلبك قيد المراجعة.";
      else if (existing.status === "approved") reason = "لديك حساب مفعل بالفعل.";
      else if (existing.status === "blacklisted") reason = "أنت في القائمة السوداء.";
      return interaction.reply?.({ content: `لا يمكن إرسال طلب جديد: **${reason}**`, ephemeral: true });
    }

    U[id] = {
      name: draft.name,
      country: draft.country,
      age: draft.age,
      birth: draft.birth,
      income: draft.income,
      rank: existing?.rank || g.ranks?.[0] || "Bronze",
      balance: existing?.balance || 0,
      status: "pending",
      kind: draft.kind,
      faction: draft.kind === "فصيل" ? (draft.faction || "غير محدد") : null,
    };
    saveUsers(U);

    // clear components from the ephemeral selection message (if any)
    if (interaction.isAnySelectMenu?.() || interaction.isButton?.()) {
      await interaction.update({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", components: [] });
    } else if (!interaction.replied) {
      await interaction.reply({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", ephemeral: true });
    }

    // send review card to the configured review channel
    client.emit("userRegistered", gid, {
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
    console.error("finalizeRegistration:", e);
    if (!interaction.replied) await interaction.reply({ content: "حدث خطأ أثناء الإرسال.", ephemeral: true });
  }
}

/* --------------------------- Interactions --------------------------- */
client.on("interactionCreate", async (interaction) => {
  try {
    // slash commands
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;
      const ctx = {
        users: loadUsers,
        saveUsers,
        gconf: GC.get,
      };
      await cmd.execute(interaction, ctx);
      return;
    }

    /* ====== Registration flow: selects after modal ====== */

    // الحالة -> remove its row; if "فصيل" show faction row, else finalize
    if (interaction.isStringSelectMenu() && interaction.customId === "reg_status_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.kind = interaction.values?.[0];
      regDraft.set(interaction.user.id, d);

      // keep only (optional) faction + submit (fallback)
      const submitRow = interaction.message.components.find((r) =>
        r.components?.some((c) => c.customId === "reg_submit_after")
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
        const rows = submitRow ? [factionRow, submitRow] : [factionRow];
        return interaction.update({ components: rows });
      }

      return finalizeRegistration(interaction, d);
    }

    // الفصيل -> finalize
    if (interaction.isStringSelectMenu() && interaction.customId === "reg_faction_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.faction = interaction.values?.[0] || null;
      regDraft.set(interaction.user.id, d);
      return finalizeRegistration(interaction, d);
    }

    // fallback manual submit button
    if (interaction.isButton() && interaction.customId === "reg_submit_after") {
      const d = regDraft.get(interaction.user.id);
      if (!d) {
        return interaction.reply({ content: "انتهت الجلسة. أعد تشغيل /register.", ephemeral: true });
      }
      return finalizeRegistration(interaction, d);
    }

    /* ====== Admin buttons (NO approve/reject here) ====== */
    if (interaction.isButton()) {
      const gid = interaction.guildId;
      const g = GC.get(gid);
      const users = loadUsers();
      const [action, userId, extra] = interaction.customId.split("_");

      // HARD GUARD: approve/reject only in review channel
      if ((action === "approve" || action === "reject")) {
        if (interaction.channelId !== g.ADMIN_CHANNEL_ID) {
          return interaction.reply({ content: "يمكن القبول/الرفض فقط في قناة المراجعة.", ephemeral: true });
        }
        if (!hasPermission(interaction.member, action === "approve" ? "approve" : "reject", g.ADMIN_ROLE_ID)) {
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        }
        const u = users[userId];
        if (!u) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        if (u.status !== "pending") {
          return interaction.reply({ content: `لا يمكن الإجراء لأن الحالة **${u.status}**.`, ephemeral: true });
        }

        const approved = action === "approve";
        u.status = approved ? "approved" : "rejected";
        saveUsers(users);

        await interaction.update({
          content: `${approved ? "✅" : "⛔"} تم ${approved ? "قبول" : "رفض"} طلب فتح الحساب لـ ${u.name} (${userId})`,
          components: [],
        });

        return;
      }

      // Everything else (promote / addBalance / freeze / fees ...)
      if (action === "blacklist") {
        if (!hasPermission(interaction.member, "blacklist", g.ADMIN_ROLE_ID))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const u = users[userId];
        if (!u) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        u.status = "blacklisted";
        saveUsers(users);
        return interaction.reply({ content: `🚫 تم إضافة <@${userId}> إلى القائمة السوداء.`, ephemeral: true });
      }

      if (action === "promote") {
        if (!hasPermission(interaction.member, "promote", g.ADMIN_ROLE_ID))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const rankRow = new ActionRowBuilder().addComponents(
          ...(g.ranks || ["Bronze", "Silver", "Gold"]).map((label) =>
            new ButtonBuilder().setCustomId(`setrank_${userId}_${label}`).setLabel(label).setStyle(ButtonStyle.Secondary)
          )
        );
        return interaction.reply({ content: `اختر رتبة <@${userId}>:`, components: [rankRow], ephemeral: true });
      }

      if (action === "setrank") {
        if (!hasPermission(interaction.member, "promote", g.ADMIN_ROLE_ID))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const u = users[userId];
        if (!u) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        u.rank = extra;
        saveUsers(users);
        return interaction.update({ content: `📈 تم تحديث رتبة <@${userId}> إلى **${extra}**`, components: [] });
      }

      if (action === "addBalance") {
        if (!hasPermission(interaction.member, "addBalance", g.ADMIN_ROLE_ID))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`addBalanceModal_${userId}`).setTitle("إضافة رصيد");
        const amount = new TextInputBuilder()
          .setCustomId("amount")
          .setLabel(`المبلغ (${g.CURRENCY_SYMBOL || "$"})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(amount));
        return interaction.showModal(modal);
      }

      if (action === "freeze" || action === "unfreeze") {
        if (!hasPermission(interaction.member, "freeze", g.ADMIN_ROLE_ID))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });
        const u = users[userId];
        if (!u) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
        u.frozen = action === "freeze";
        saveUsers(users);
        return interaction.reply({ content: `تم ${u.frozen ? "تجميد" : "إلغاء تجميد"} حساب <@${userId}>.`, ephemeral: true });
      }

      if (action === "fees") {
        if (!hasPermission(interaction.member, "editFee", g.ADMIN_ROLE_ID))
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

    // add balance modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith("addBalanceModal_")) {
      const gid = interaction.guildId;
      const g = GC.get(gid);
      if (!hasPermission(interaction.member, "addBalance", g.ADMIN_ROLE_ID))
        return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });

      const userId = interaction.customId.split("_")[1];
      const users = loadUsers();
      const u = users[userId];
      if (!u) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", ephemeral: true });
      const amount = parseFloat(interaction.fields.getTextInputValue("amount"));
      if (isNaN(amount) || amount <= 0) return interaction.reply({ content: "أدخل مبلغًا صحيحًا.", ephemeral: true });
      u.balance = (u.balance || 0) + amount;
      saveUsers(users);
      return interaction.reply({ content: `✅ أضيف ${amount}${g.CURRENCY_SYMBOL || "$"} إلى <@${userId}>`, ephemeral: true });
    }

    // fees modal
    if (interaction.isModalSubmit() && interaction.customId === "feesModal") {
      const gid = interaction.guildId;
      const g = GC.get(gid);
      if (!hasPermission(interaction.member, "editFee", g.ADMIN_ROLE_ID))
        return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", ephemeral: true });

      const dep = Number(interaction.fields.getTextInputValue("deposit"));
      const trn = Number(interaction.fields.getTextInputValue("transfer"));
      const wdr = Number(interaction.fields.getTextInputValue("withdraw"));
      for (const v of [dep, trn, wdr]) {
        if (!Number.isFinite(v) || v < 0 || v > 100)
          return interaction.reply({ content: "الرسوم بين 0 و 100.", ephemeral: true });
      }
      // save to per-guild config
      GC.set(gid, { fees: { DEPOSIT_FEE: dep, TRANSFER_FEE: trn, WITHDRAW_FEE: wdr } });
      return interaction.reply({ content: `تم التحديث: إيداع ${dep}% • تحويل ${trn}% • سحب ${wdr}%`, ephemeral: true });
    }

    // register modal (collect basic info, then ask for الحالة/الفصيل)
    if (interaction.isModalSubmit() && interaction.customId === "registerModal") {
      const gid = interaction.guildId;
      const g = GC.get(gid);

      if (g.REGISTER_CHANNEL_ID && interaction.channelId !== g.REGISTER_CHANNEL_ID) {
        return interaction.reply({ content: `استخدم الأمر في قناة التسجيل <#${g.REGISTER_CHANNEL_ID}>.`, ephemeral: true });
      }

      try {
        const name = interaction.fields.getTextInputValue("name").trim();
        const country = interaction.fields.getTextInputValue("country").trim();
        const age = parseInt(interaction.fields.getTextInputValue("age").trim(), 10);
        const birth = interaction.fields.getTextInputValue("birth").trim();
        const income = parseInt(interaction.fields.getTextInputValue("income").trim(), 10);

        if (!name || !country || !Number.isFinite(age) || age < 16 || age > 65 ||
            !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birth) || !Number.isFinite(income) || income <= 0) {
          return interaction.reply({ content: "البيانات غير صحيحة.", ephemeral: true });
        }
        if (income < (g.MIN_DEPOSIT || 0)) {
          return interaction.reply({ content: `الحد الأدنى للدخل ${g.MIN_DEPOSIT} ${g.CURRENCY_SYMBOL || "$"}.`, ephemeral: true });
        }

        regDraft.set(interaction.user.id, { name, country, age, birth, income });

        const statusSelect = new StringSelectMenuBuilder()
          .setCustomId("reg_status_after")
          .setPlaceholder("اختر الحالة")
          .addOptions({ label: "مدني", value: "مدني" }, { label: "عصابة", value: "عصابة" }, { label: "فصيل", value: "فصيل" });

        const confirmBtn = new ButtonBuilder()
          .setCustomId("reg_submit_after")
          .setLabel("إرسال الطلب")
          .setStyle(ButtonStyle.Primary);

        return interaction.reply({
          content: "📋 تم استلام النموذج. اختر **الحالة** (إن اخترت فصيل سيظهر اختيار الفصيل).",
          components: [new ActionRowBuilder().addComponents(statusSelect), new ActionRowBuilder().addComponents(confirmBtn)],
          ephemeral: true,
        });
      } catch (e) {
        console.error("registerModal:", e);
        if (!interaction.replied) return interaction.reply({ content: "فشل التسجيل.", ephemeral: true });
      }
    }
  } catch (err) {
    console.error("interaction error:", err);
  }
});

/* -------------- send review card (with Approve/Reject) -------------- */
client.on("userRegistered", async (guildId, user) => {
  const g = GC.get(guildId);
  try {
    const ch =
      client.channels.cache.get(g.ADMIN_CHANNEL_ID) ||
      (await client.channels.fetch?.(g.ADMIN_CHANNEL_ID).catch(() => null));
    if (!ch) return console.warn("[review] channel not found for guild", guildId);

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
        { name: "الدخل الشهري", value: String(user.income ?? 0), inline: true },
        { name: "الحالة", value: String(user.kind || "مدني"), inline: true },
        { name: "الفصيل", value: String(user.faction || "—"), inline: true },
        { name: "ID", value: String(user.id), inline: false }
      )
      .setFooter({ text: "يرجى المراجعة والقبول/الرفض." });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve_${user.id}`).setLabel("موافقة").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject_${user.id}`).setLabel("رفض").setStyle(ButtonStyle.Danger)
    );

    await ch.send({ embeds: [embed], components: [row] });
  } catch (e) {
    console.error("send review:", e);
  }
});

client.login(process.env.TOKEN);
