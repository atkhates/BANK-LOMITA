// index.js — Arabic bank bot: register flow + admin actions (+ withdraw) + per-guild config

require("dotenv").config();
const fs = require("fs");
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
  ChannelType,
} = require("discord.js");

// ===== app modules / local files =====
const permsMap = require("./permissions.json");
const GC = require("./guildConfig"); // per-guild config accessor (get/set/patch)
let Sheets; try { Sheets = require("./sheets"); } catch { Sheets = { syncUsers: async () => {}, logTx: async () => {}, onUserChange: async () => {} }; }

// ===== Discord client =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.commands = new Collection();
for (const f of fs.readdirSync("./commands").filter(x => x.endsWith(".js"))) {
  const mod = require(`./commands/${f}`);
  if (mod?.data?.name) client.commands.set(mod.data.name, mod);
}

// ===== util: file & persistence =====
function ensureFile(path) {
  const dir = path.split("/").slice(0, -1).join("/");
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path)) fs.writeFileSync(path, path.endsWith(".json") ? "{}" : "");
}

function loadUsers() {
  ensureFile("./database/users.json");
  return JSON.parse(fs.readFileSync("./database/users.json", "utf8") || "{}");
}
function saveUsers(users) {
  ensureFile("./database/users.json");
  fs.writeFileSync("./database/users.json", JSON.stringify(users, null, 2));
  // sync to Google Sheet if available
  Promise.resolve(Sheets.syncUsers(users)).catch(() => {});
}

function loadTx() {
  ensureFile("./database/transactions.json");
  try { return JSON.parse(fs.readFileSync("./database/transactions.json", "utf8") || "[]"); }
  catch { return []; }
}
function saveTx(arr) {
  ensureFile("./database/transactions.json");
  fs.writeFileSync("./database/transactions.json", JSON.stringify(arr, null, 2));
}
function pushTx(entry) {
  const arr = loadTx();
  arr.push({ ts: new Date().toISOString(), ...entry });
  saveTx(arr);
  // sheet log if provided
  Promise.resolve(Sheets.logTx(entry)).catch(() => {});
}

// ===== helpers: perms & logs =====
function hasAnyRoleId(member, ids = []) {
  if (!ids?.length) return false;
  return member.roles.cache.some(r => ids.includes(r.id));
}
function hasPermission(member, key, gconf) {
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    (gconf.ADMIN_ROLE_ID && member.roles.cache.has(gconf.ADMIN_ROLE_ID)) ||
    hasAnyRoleId(member, permsMap[key] || [])
  );
}

async function pushLog(guildId, content) {
  const gconf = GC.get(guildId);
  if (!gconf.ADMIN_LOG_CHANNEL_ID) return;
  try {
    const ch =
      client.channels.cache.get(gconf.ADMIN_LOG_CHANNEL_ID) ||
      (await client.channels.fetch(gconf.ADMIN_LOG_CHANNEL_ID).catch(() => null));
    if (ch) ch.send(String(content));
  } catch {}
}

// Transaction log to dedicated channel
async function logTransaction(guildId, embed) {
  const gconf = GC.get(guildId);
  if (!gconf.TRANSACTION_LOG_CHANNEL_ID) return;
  try {
    const ch =
      client.channels.cache.get(gconf.TRANSACTION_LOG_CHANNEL_ID) ||
      (await client.channels.fetch(gconf.TRANSACTION_LOG_CHANNEL_ID).catch(() => null));
    if (ch) {
      if (typeof embed === 'string') {
        ch.send(embed);
      } else {
        ch.send({ embeds: [embed] });
      }
    }
  } catch {}
}

// Small summary to the reglist channel (optional)
async function updateRegList(guildId) {
  const gconf = GC.get(guildId);
  if (!gconf.REGLIST_CHANNEL_ID) return;

  const users = loadUsers();
  let pending = 0, approved = 0, rejected = 0, blacklisted = 0;
  for (const id of Object.keys(users)) {
    const st = (users[id].status || "").toLowerCase();
    if (st === "pending") pending++;
    else if (st === "approved") approved++;
    else if (st === "rejected") rejected++;
    else if (st === "blacklisted") blacklisted++;
  }

  try {
    const ch =
      client.channels.cache.get(gconf.REGLIST_CHANNEL_ID) ||
      (await client.channels.fetch(gconf.REGLIST_CHANNEL_ID).catch(() => null));
    if (!ch) return;

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle("قائمة التسجيلات")
      .setDescription("ملخص حالات طلبات فتح الحساب")
      .addFields(
        { name: "قيد المراجعة", value: String(pending), inline: true },
        { name: "مقبول", value: String(approved), inline: true },
        { name: "مرفوض", value: String(rejected), inline: true },
        { name: "قائمة سوداء", value: String(blacklisted), inline: true },
      )
      .setFooter({ text: new Date().toLocaleString() });

    await ch.send({ embeds: [embed] });
  } catch {}
}

// ===== register draft between modal & selects =====
const regDraft = new Map();

// ===== events =====
client.once("clientReady", () => {
  console.log(`تم التشغيل بنجاح: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    const gconf = GC.get(interaction.guildId || "");

    // Slash commands
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      // pass helpers into commands
      await cmd.execute(interaction, {
        gconf: (gid) => GC.get(gid || interaction.guildId),
        users: loadUsers,
        saveUsers,
        updateRegList,
        pushTx,
        pushLog,
        logTransaction,
      });
      return;
    }

    // ====== Select menus for registration ======
    if (interaction.isStringSelectMenu() && interaction.customId === "reg_status_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.kind = interaction.values?.[0];
      regDraft.set(interaction.user.id, d);

      // status chosen -> remove status menu; if فصيل then show faction select, otherwise finalize
      if (d.kind === "فصيل") {
        const factionRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("reg_faction_after")
            .setPlaceholder("اختر الفصيل")
            .addOptions(
              { label: "شرطة", value: "شرطة" },
              { label: "جيش", value: "جيش" },
              { label: "طب", value: "طب" },
            )
        );
        // keep submit fallback row if exists
        const submitRow = interaction.message.components.find(r =>
          r.components?.some(c => c.customId === "reg_submit_after")
        );
        const rows = submitRow ? [factionRow, submitRow] : [factionRow];
        return interaction.update({ components: rows });
      }

      // Not a faction -> finalize
      return finalizeRegistration(interaction, d);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "reg_faction_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.faction = interaction.values?.[0] || null;
      regDraft.set(interaction.user.id, d);
      return finalizeRegistration(interaction, d);
    }

    // Fallback register submit button
    if (interaction.isButton() && interaction.customId === "reg_submit_after") {
      const d = regDraft.get(interaction.user.id);
      if (!d)
        return interaction.reply({ content: "انتهت الجلسة أو البيانات غير موجودة. أعد تشغيل /register.", flags: 64 });
      return finalizeRegistration(interaction, d);
    }

    // ====== Admin buttons ======
    if (interaction.isButton()) {
      const [action, userId, extra] = interaction.customId.split("_");
      const users = loadUsers();
      const target = users[userId];

      // Approve/Reject
      if (action === "approve" || action === "reject") {
        const permKey = action === "approve" ? "approve" : "reject";
        if (!hasPermission(interaction.member, permKey, gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });

        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });
        if (target.status !== "pending")
          return interaction.reply({ content: `لا يمكن تنفيذ هذا الإجراء لأن الحالة الحالية هي **${target.status}**.`, flags: 64 });

        // Defer to prevent timeout
        await interaction.deferUpdate();

        const approved = (action === "approve");
        target.status = approved ? "approved" : "rejected";
        saveUsers(users);
        await Sheets.onUserChange?.({ id: userId, ...target }).catch(() => {});
        await updateRegList(interaction.guildId);

        await pushLog(interaction.guildId, `${approved ? "✅" : "⛔"} ${interaction.user.username} ${approved ? "قبل" : "رفض"} حساب <@${userId}>`);

        await interaction.editReply({ content: `${approved ? "✅ تمت الموافقة" : "⛔ تم الرفض"} على طلب **${target.name}** (${userId})`, components: [] });
        return;
      }

      // Add balance
      if (action === "addBalance") {
        if (!hasPermission(interaction.member, "addBalance", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });

        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });

        const modal = new ModalBuilder().setCustomId(`addBalanceModal_${userId}`).setTitle("إضافة رصيد");
        const amountInput = new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("المبلغ")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        return interaction.showModal(modal);
      }

      // Withdraw
      if (action === "withdraw") {
        if (!hasPermission(interaction.member, "addBalance", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });

        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });

        const modal = new ModalBuilder().setCustomId(`withdrawModal_${userId}`).setTitle("سحب رصيد");
        const amountInput = new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("المبلغ للسحب")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        return interaction.showModal(modal);
      }

      // Promote → row of ranks
      if (action === "promote") {
        if (!hasPermission(interaction.member, "promote", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });

        const rankRow = new ActionRowBuilder().addComponents(
          ...(gconf.ranks || ["Bronze","Silver","Gold"]).map(r =>
            new ButtonBuilder().setCustomId(`setrank_${userId}_${r}`).setLabel(r).setStyle(ButtonStyle.Secondary)
          )
        );
        return interaction.reply({ content: `اختر الرتبة الجديدة لـ <@${userId}>:`, components: [rankRow], flags: 64 });
      }

      if (action === "setrank") {
        if (!hasPermission(interaction.member, "promote", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });
        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });
        target.rank = extra;
        saveUsers(users);
        await Sheets.onUserChange?.({ id: userId, ...target }).catch(() => {});
        await interaction.update({ content: `📈 تم تحديث رتبة <@${userId}> إلى **${extra}**`, components: [] });
        await pushLog(interaction.guildId, `📈 رتبة <@${userId}> أصبحت **${extra}** بواسطة ${interaction.user.username}`);
        return;
      }

      // Freeze / Unfreeze
      if (action === "freeze" || action === "unfreeze") {
        if (!hasPermission(interaction.member, "freeze", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });
        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });
        target.frozen = (action === "freeze");
        saveUsers(users);
        await interaction.reply({ content: `تم ${target.frozen ? "تجميد" : "إلغاء تجميد"} حساب <@${userId}>.`, flags: 64 });
        await pushLog(interaction.guildId, `${target.frozen ? "🧊" : "🔥"} ${target.frozen ? "تم تجميد" : "تم إلغاء تجميد"} حساب <@${userId}> بواسطة ${interaction.user.username}`);
        return;
      }

      // Edit fees
      if (action === "fees") {
        if (!hasPermission(interaction.member, "editFee", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });
        const modal = new ModalBuilder().setCustomId("feesModal").setTitle("تعديل الرسوم البنكية");
        const dep = new TextInputBuilder().setCustomId("deposit").setLabel("رسوم الإيداع %").setStyle(TextInputStyle.Short).setRequired(true);
        const trn = new TextInputBuilder().setCustomId("transfer").setLabel("رسوم التحويل %").setStyle(TextInputStyle.Short).setRequired(true);
        const wdr = new TextInputBuilder().setCustomId("withdraw").setLabel("رسوم السحب %").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(dep),
          new ActionRowBuilder().addComponents(trn),
          new ActionRowBuilder().addComponents(wdr),
        );
        return interaction.showModal(modal);
      }

      // Edit user info
      if (action === "editInfo") {
        if (!hasPermission(interaction.member, "editInfo", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });
        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });
        
        const modal = new ModalBuilder().setCustomId(`editInfoModal_${userId}`).setTitle("تعديل معلومات المستخدم");
        const nameInput = new TextInputBuilder().setCustomId("name").setLabel("الاسم").setStyle(TextInputStyle.Short).setValue(target.name || "").setRequired(true);
        const phoneInput = new TextInputBuilder().setCustomId("phone").setLabel("رقم الهاتف").setStyle(TextInputStyle.Short).setValue(target.phone || "").setRequired(true);
        const countryInput = new TextInputBuilder().setCustomId("country").setLabel("البلد").setStyle(TextInputStyle.Short).setValue(target.country || "").setRequired(true);
        const ageInput = new TextInputBuilder().setCustomId("age").setLabel("العمر").setStyle(TextInputStyle.Short).setValue(String(target.age || "")).setRequired(true);
        const birthInput = new TextInputBuilder().setCustomId("birth").setLabel("تاريخ الميلاد (YYYY-MM-DD)").setStyle(TextInputStyle.Short).setValue(target.birth || "").setRequired(true);
        
        modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(phoneInput),
          new ActionRowBuilder().addComponents(countryInput),
          new ActionRowBuilder().addComponents(ageInput),
          new ActionRowBuilder().addComponents(birthInput)
        );
        return interaction.showModal(modal);
      }

      // Blacklist user
      if (action === "blacklist") {
        if (!hasPermission(interaction.member, "blacklist", gconf))
          return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });
        if (!target) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });
        
        target.status = "blacklisted";
        target.frozen = true;
        saveUsers(users);
        await Sheets.onUserChange?.({ id: userId, ...target }).catch(() => {});
        await interaction.reply({ content: `⛔ تم إضافة <@${userId}> إلى القائمة السوداء.`, flags: 64 });
        await pushLog(interaction.guildId, `⛔ <@${interaction.user.id}> أضاف <@${userId}> إلى القائمة السوداء`);
        return;
      }
    }

    // ====== Modals ======

    // Add balance submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith("addBalanceModal_")) {
      if (!hasPermission(interaction.member, "addBalance", gconf))
        return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });

      const userId = interaction.customId.split("_")[1];
      const users = loadUsers();
      const user = users[userId];
      if (!user) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });

      const amount = parseFloat(interaction.fields.getTextInputValue("amount"));
      if (isNaN(amount) || amount <= 0) return interaction.reply({ content: "رجاءً أدخل مبلغًا صالحًا أكبر من 0.", flags: 64 });

      user.balance = (user.balance || 0) + amount;
      saveUsers(users);

      pushTx({ type: "admin_deposit", guildId: interaction.guildId, to: userId, amount, fee: 0 });

      // Log to transaction channel
      const depositEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("➕ إيداع إداري")
        .addFields(
          { name: "المسؤول", value: `<@${interaction.user.id}>`, inline: true },
          { name: "المستلم", value: `<@${userId}> (${user.name || "غير معروف"})`, inline: true },
          { name: "المبلغ", value: `${amount}${gconf.CURRENCY_SYMBOL || "$"}`, inline: true },
          { name: "الرصيد الجديد", value: `${user.balance}${gconf.CURRENCY_SYMBOL || "$"}`, inline: true }
        )
        .setTimestamp();
      
      logTransaction(interaction.guildId, depositEmbed);
      await pushLog(interaction.guildId, `💰 <@${interaction.user.id}> أضاف ${amount}${gconf.CURRENCY_SYMBOL || "$"} إلى حساب <@${userId}>. الرصيد الجديد: ${user.balance}${gconf.CURRENCY_SYMBOL || "$"}`);

      await interaction.reply({ content: `✅ تم إضافة ${amount}${gconf.CURRENCY_SYMBOL || "$"} إلى <@${userId}>. الرصيد: ${user.balance}${gconf.CURRENCY_SYMBOL || "$"}`, flags: 64 });
      return;
    }

    // Withdraw submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith("withdrawModal_")) {
      if (!hasPermission(interaction.member, "addBalance", gconf))
        return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });

      const userId = interaction.customId.split("_")[1];
      const users = loadUsers();
      const user = users[userId];
      if (!user) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });
      if (user.frozen) return interaction.reply({ content: "الحساب مجمّد. لا يمكن السحب.", flags: 64 });

      const amount = parseFloat(interaction.fields.getTextInputValue("amount"));
      if (isNaN(amount) || amount <= 0) return interaction.reply({ content: "رجاءً أدخل مبلغًا صالحًا أكبر من 0.", flags: 64 });

      const feePct = gconf.fees?.WITHDRAW_FEE || 0;
      const fee = Math.floor((amount * feePct) / 100);
      const totalDebit = amount + fee;

      if ((user.balance || 0) < totalDebit)
        return interaction.reply({ content: "الرصيد غير كافٍ.", flags: 64 });

      user.balance = (user.balance || 0) - totalDebit;
      saveUsers(users);

      pushTx({ type: "admin_withdraw", guildId: interaction.guildId, from: userId, amount, fee });

      // Log to transaction channel
      const withdrawEmbed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle("➖ سحب إداري")
        .addFields(
          { name: "المسؤول", value: `<@${interaction.user.id}>`, inline: true },
          { name: "المستخدم", value: `<@${userId}> (${user.name || "غير معروف"})`, inline: true },
          { name: "المبلغ", value: `${amount}${gconf.CURRENCY_SYMBOL || "$"}`, inline: true },
          { name: "الرسوم", value: `${fee}${gconf.CURRENCY_SYMBOL || "$"}`, inline: true },
          { name: "الإجمالي المسحوب", value: `${totalDebit}${gconf.CURRENCY_SYMBOL || "$"}`, inline: true },
          { name: "الرصيد المتبقي", value: `${user.balance}${gconf.CURRENCY_SYMBOL || "$"}`, inline: true }
        )
        .setTimestamp();
      
      logTransaction(interaction.guildId, withdrawEmbed);
      await pushLog(interaction.guildId, `💸 <@${interaction.user.id}> سحب ${amount}${gconf.CURRENCY_SYMBOL || "$"} من حساب <@${userId}> (رسوم: ${fee}${gconf.CURRENCY_SYMBOL || "$"}). الرصيد المتبقي: ${user.balance}${gconf.CURRENCY_SYMBOL || "$"}`);

      await interaction.reply({ content: `✅ تم سحب ${amount}${gconf.CURRENCY_SYMBOL || "$"} من <@${userId}> (رسم: ${fee}${gconf.CURRENCY_SYMBOL || "$"}). الرصيد الحالي: ${user.balance}${gconf.CURRENCY_SYMBOL || "$"}`, flags: 64 });
      return;
    }

    // Fees modal submit
    if (interaction.isModalSubmit() && interaction.customId === "feesModal") {
      if (!hasPermission(interaction.member, "editFee", gconf))
        return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });

      const dep = Number(interaction.fields.getTextInputValue("deposit"));
      const trn = Number(interaction.fields.getTextInputValue("transfer"));
      const wdr = Number(interaction.fields.getTextInputValue("withdraw"));
      for (const v of [dep, trn, wdr]) {
        if (!Number.isFinite(v) || v < 0 || v > 100) {
          return interaction.reply({ content: "يجب أن تكون الرسوم بين 0 و 100.", flags: 64 });
        }
      }
      GC.patch(interaction.guildId, { fees: { DEPOSIT_FEE: dep, TRANSFER_FEE: trn, WITHDRAW_FEE: wdr } });
      await pushLog(interaction.guildId, `💵 <@${interaction.user.id}> قام بتحديث الرسوم: إيداع ${dep}% • تحويل ${trn}% • سحب ${wdr}%`);
      return interaction.reply({ content: `تم تحديث الرسوم: إيداع ${dep}% • تحويل ${trn}% • سحب ${wdr}%`, flags: 64 });
    }

    // Edit info modal submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith("editInfoModal_")) {
      if (!hasPermission(interaction.member, "editInfo", gconf))
        return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });

      const userId = interaction.customId.split("_")[1];
      const users = loadUsers();
      const user = users[userId];
      if (!user) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });

      const name = interaction.fields.getTextInputValue("name").trim();
      const phone = interaction.fields.getTextInputValue("phone").trim();
      const country = interaction.fields.getTextInputValue("country").trim();
      const age = parseInt(interaction.fields.getTextInputValue("age").trim(), 10);
      const birth = interaction.fields.getTextInputValue("birth").trim();

      if (!name || !phone || !country || !Number.isFinite(age) || age < 1 || age > 150 ||
          !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birth)) {
        return interaction.reply({ content: "رجاءً أدخل بيانات صحيحة.", flags: 64 });
      }

      // Defer to prevent timeout
      await interaction.deferReply({ flags: 64 });

      user.name = name;
      user.phone = phone;
      user.country = country;
      user.age = age;
      user.birth = birth;
      user.updatedAt = new Date().toISOString();

      saveUsers(users);
      await Sheets.onUserChange?.({ id: userId, ...user }).catch(() => {});

      await pushLog(interaction.guildId, `✏️ ${interaction.user.username} قام بتعديل معلومات <@${userId}>`);
      return interaction.editReply({ content: `✅ تم تحديث معلومات <@${userId}> بنجاح.` });
    }
    
    // Edit income modal (shown after editInfo modal)
    if (interaction.isButton() && interaction.customId.startsWith("editIncome_")) {
      const userId = interaction.customId.split("_")[1];
      const users = loadUsers();
      const user = users[userId];
      if (!user) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });
      
      const incomeModal = new ModalBuilder().setCustomId(`editIncomeModal_${userId}`).setTitle("تعديل الدخل والنوع");
      const incomeInput = new TextInputBuilder().setCustomId("income").setLabel("الدخل").setStyle(TextInputStyle.Short).setValue(String(user.income || 0)).setRequired(true);
      const kindInput = new TextInputBuilder().setCustomId("kind").setLabel("النوع (مدني/عصابة/فصيل)").setStyle(TextInputStyle.Short).setValue(user.kind || "").setRequired(true);
      const factionInput = new TextInputBuilder().setCustomId("faction").setLabel("الفصيل (شرطة/جيش/طب أو فارغ)").setStyle(TextInputStyle.Short).setValue(user.faction || "").setRequired(false);
      
      incomeModal.addComponents(
        new ActionRowBuilder().addComponents(incomeInput),
        new ActionRowBuilder().addComponents(kindInput),
        new ActionRowBuilder().addComponents(factionInput)
      );
      return interaction.showModal(incomeModal);
    }
    
    // Edit income modal submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith("editIncomeModal_")) {
      if (!hasPermission(interaction.member, "editInfo", gconf))
        return interaction.reply({ content: "لا تملك صلاحية هذا الإجراء.", flags: 64 });

      const userId = interaction.customId.split("_")[1];
      const users = loadUsers();
      const user = users[userId];
      if (!user) return interaction.reply({ content: "لم يتم العثور على سجل المستخدم.", flags: 64 });

      const income = parseInt(interaction.fields.getTextInputValue("income").trim(), 10);
      const kind = interaction.fields.getTextInputValue("kind").trim();
      const faction = interaction.fields.getTextInputValue("faction").trim();

      if (!Number.isFinite(income) || income < 0 || !kind) {
        return interaction.reply({ content: "رجاءً أدخل بيانات صحيحة.", flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

      user.income = income;
      user.kind = kind;
      user.faction = faction || null;
      user.updatedAt = new Date().toISOString();

      saveUsers(users);
      await Sheets.onUserChange?.({ id: userId, ...user }).catch(() => {});

      await pushLog(interaction.guildId, `✏️ ${interaction.user.username} قام بتعديل الدخل والنوع لـ <@${userId}>`);
      return interaction.editReply({ content: `✅ تم تحديث الدخل والنوع لـ <@${userId}> بنجاح.` });
    }

    // Register modal submit (step 1: personal info) → prompt for income
    if (interaction.isModalSubmit() && interaction.customId === "registerModal") {
      if (gconf.REGISTER_CHANNEL_ID && interaction.channelId !== gconf.REGISTER_CHANNEL_ID) {
        return interaction.reply({ content: `يمكن إرسال طلب التسجيل فقط من داخل <#${gconf.REGISTER_CHANNEL_ID}>.`, flags: 64 });
      }

      const name = interaction.fields.getTextInputValue("name").trim();
      const phone = interaction.fields.getTextInputValue("phone").trim();
      const country = interaction.fields.getTextInputValue("country").trim();
      const age = parseInt(interaction.fields.getTextInputValue("age").trim(), 10);
      const birth = interaction.fields.getTextInputValue("birth").trim();

      if (!name || !phone || !country || !Number.isFinite(age) || age < 16 || age > 65 ||
          !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birth)) {
        return interaction.reply({ content: "رجاءً أدخل بيانات تسجيل صحيحة.", flags: 64 });
      }

      // stash draft (without income yet)
      regDraft.set(interaction.user.id, { name, phone, country, age, birth });

      // Ask for income in next step
      const incomeBtn = new ButtonBuilder()
        .setCustomId("reg_income_btn")
        .setLabel("📊 إدخال الدخل الشهري")
        .setStyle(ButtonStyle.Primary);

      return interaction.reply({
        content: "✅ تم استلام المعلومات الشخصية.\n\n📋 **الخطوة التالية:** أدخل الدخل الشهري للمتابعة.",
        components: [new ActionRowBuilder().addComponents(incomeBtn)],
        flags: 64,
      });
    }

    // Income button → show income modal
    if (interaction.isButton() && interaction.customId === "reg_income_btn") {
      const draft = regDraft.get(interaction.user.id);
      if (!draft) {
        return interaction.reply({ content: "يرجى البدء من جديد بأمر /register", flags: 64 });
      }

      const incomeModal = new ModalBuilder()
        .setCustomId("registerIncomeModal")
        .setTitle("الدخل الشهري");
      
      const incomeInput = new TextInputBuilder()
        .setCustomId("income")
        .setLabel("أدخل دخلك الشهري")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("مثال: 50000")
        .setRequired(true);

      incomeModal.addComponents(new ActionRowBuilder().addComponents(incomeInput));
      return interaction.showModal(incomeModal);
    }

    // Income modal submit → prompt for status/kind
    if (interaction.isModalSubmit() && interaction.customId === "registerIncomeModal") {
      const draft = regDraft.get(interaction.user.id);
      if (!draft) {
        return interaction.reply({ content: "يرجى البدء من جديد بأمر /register", flags: 64 });
      }

      const income = parseInt(interaction.fields.getTextInputValue("income").trim(), 10);

      if (!Number.isFinite(income) || income <= 0) {
        return interaction.reply({ content: "رجاءً أدخل دخلاً صحيحاً أكبر من 0.", flags: 64 });
      }
      if (income < (gconf.MIN_DEPOSIT || 0)) {
        return interaction.reply({ content: `الحد الأدنى للدخل هو ${gconf.MIN_DEPOSIT} ${gconf.CURRENCY_SYMBOL || "$"}.`, flags: 64 });
      }

      // Update draft with income
      draft.income = income;
      regDraft.set(interaction.user.id, draft);

      // Now show status selection
      const statusSelect = new StringSelectMenuBuilder()
        .setCustomId("reg_status_after")
        .setPlaceholder("اختر الحالة")
        .addOptions(
          { label: "مدني", value: "مدني" },
          { label: "عصابة", value: "عصابة" },
          { label: "فصيل", value: "فصيل" },
        );

      const confirmBtn = new ButtonBuilder()
        .setCustomId("reg_submit_after")
        .setLabel("إرسال الطلب")
        .setStyle(ButtonStyle.Primary);

      return interaction.reply({
        content: "✅ تم استلام الدخل.\n\n📋 **الخطوة الأخيرة:** اختر **الحالة**.\nإذا اخترت **فصيل** سيظهر اختيار الفصيل، وبعدها سيتم الإرسال تلقائيًا.",
        components: [
          new ActionRowBuilder().addComponents(statusSelect),
          new ActionRowBuilder().addComponents(confirmBtn),
        ],
        flags: 64,
      });
    }

  } catch (err) {
    console.error("interaction error:", err);
  }
});

// ===== finalize registration helper =====
async function finalizeRegistration(interaction, draft) {
  try {
    const gconf = GC.get(interaction.guildId);
    if (!draft?.kind)
      return interaction.reply?.({ content: "الرجاء اختيار الحالة.", flags: 64 });
    if (draft.kind === "فصيل" && !draft.faction)
      return interaction.reply?.({ content: "اختر الفصيل قبل الإرسال.", flags: 64 });

    const U = loadUsers();
    const id = interaction.user.id;
    const existing = U[id];
    if (existing && existing.status !== "rejected") {
      let reason = "لديك طلب حاليًا.";
      if (existing.status === "pending") reason = "طلبك قيد المراجعة بالفعل.";
      else if (existing.status === "approved") reason = "لديك حساب مفعل بالفعل.";
      else if (existing.status === "blacklisted") reason = "تم إدراجك في القائمة السوداء. تواصل مع الإدارة.";
      return interaction.reply?.({ content: `لا يمكن إرسال طلب جديد: **${reason}**`, flags: 64 });
    }

    // Defer the interaction to prevent timeout
    if ((interaction.isAnySelectMenu?.() || interaction.isButton?.()) && !interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }

    U[id] = {
      name: draft.name,
      phone: draft.phone,
      country: draft.country,
      age: draft.age,
      birth: draft.birth,
      income: draft.income,
      rank: existing?.rank || (gconf.ranks?.[0] || "Bronze"),
      balance: existing?.balance ?? 0,
      status: "pending",
      kind: draft.kind,
      faction: draft.kind === "فصيل" ? (draft.faction || "غير محدد") : null,
    };
    saveUsers(U);
    
    // Do async operations without blocking
    Promise.all([
      Sheets.onUserChange?.({ id, ...U[id] }).catch(() => {}),
      updateRegList(interaction.guildId)
    ]).catch(() => {});

    // clear the ephemeral UI
    if (interaction.deferred) {
      await interaction.editReply({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", components: [] });
    } else if (interaction.isAnySelectMenu?.() || interaction.isButton?.()) {
      await interaction.update({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", components: [] });
    } else if (!interaction.replied) {
      await interaction.reply({ content: "✅ تم إرسال طلب التسجيل للمراجعة.", flags: 64 });
    }

    // emit card to review channel
    client.emit("userRegistered", {
      id,
      mention: `<@${id}>`,
      tag: interaction.user.tag,
      avatar: interaction.user.displayAvatarURL({ size: 256 }),
      ...U[id],
    }, interaction.guildId);
    regDraft.delete(id);
  } catch (e) {
    console.error("finalizeRegistration error:", e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "حدث خطأ أثناء إرسال الطلب.", flags: 64 }).catch(() => {});
    } else if (interaction.deferred) {
      await interaction.editReply({ content: "حدث خطأ أثناء إرسال الطلب." }).catch(() => {});
    }
  }
}

// ===== review card sender =====
client.on("userRegistered", async (user, guildId) => {
  try {
    const gconf = GC.get(guildId);
    const reviewChannel =
      client.channels.cache.get(gconf.ADMIN_CHANNEL_ID) ||
      (await client.channels.fetch?.(gconf.ADMIN_CHANNEL_ID).catch(() => null));
    if (!reviewChannel) {
      await pushLog(guildId, `⚠️ لم أستطع إيجاد قناة المراجعة (ID: ${gconf.ADMIN_CHANNEL_ID}).`);
      return;
    }
    if (![ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildAnnouncement].includes(reviewChannel.type)) {
      await pushLog(guildId, `⚠️ القناة (${gconf.ADMIN_CHANNEL_ID}) ليست قناة نصية.`);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("مراجعة المستخدم")
      .setThumbnail(user.avatar)
      .setDescription(`${user.mention} — \n${user.tag}`)
      .addFields(
        { name: "الاسم", value: String(user.name || "—"), inline: true },
        { name: "رقم الهاتف", value: String(user.phone || "—"), inline: true },
        { name: "البلد", value: String(user.country || "—"), inline: true },
        { name: "العمر", value: String(user.age ?? "—"), inline: true },
        { name: "تاريخ الميلاد", value: String(user.birth || "—"), inline: true },
        { name: "الدخل", value: String(user.income ?? 0), inline: true },
        { name: "الرتبة", value: String(user.rank || "—"), inline: true },
        { name: "الرصيد", value: String(user.balance ?? 0), inline: true },
        { name: "الحالة", value: String(user.status || "pending"), inline: true },
        { name: "النوع", value: String(user.kind || "—"), inline: true },
        { name: "فصيل", value: String(user.faction || "—"), inline: true },
        { name: "ID", value: String(user.id), inline: false },
      );

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve_${user.id}`).setLabel("موافقة").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject_${user.id}`).setLabel("رفض").setStyle(ButtonStyle.Danger),
    );

    await reviewChannel.send({ embeds: [embed], components: [row1] });
  } catch (e) {
    console.error("userRegistered send error:", e);
  }
});

client.login(process.env.TOKEN);
