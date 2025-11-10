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

const baseConf = require("./config.json");
const permsMap = require("./permissions.json");
const GC = require("./guildConfig");
let Sheets = null;
try { Sheets = require("./sheets"); } catch { Sheets = { syncUsers:async()=>{}, logTx:async()=>{} }; }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
client.commands = new Collection();

/* load commands */
for (const f of fs.readdirSync("./commands").filter(x=>x.endsWith(".js"))) {
  const c = require(`./commands/${f}`);
  if (c?.data?.name) client.commands.set(c.data.name, c);
}

client.once("ready", () => console.log(`تم التشغيل بنجاح: ${client.user.tag}`));

/* helpers */
function ensureFile(pathLike, init="{}") {
  const dir = pathLike.split("/").slice(0,-1).join("/");
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
  if (!fs.existsSync(pathLike)) fs.writeFileSync(pathLike, init);
}
function loadUsers() {
  ensureFile("./database/users.json", "{}");
  return JSON.parse(fs.readFileSync("./database/users.json","utf8"));
}
function saveUsers(U, guild) {
  ensureFile("./database/users.json","{}");
  fs.writeFileSync("./database/users.json", JSON.stringify(U,null,2));
  Sheets.syncUsers(U).catch(()=>{});
  updateRegList(guild).catch(()=>{});
}
function pushTx(tx) {
  ensureFile("./database/transactions.json","[]");
  const arr = JSON.parse(fs.readFileSync("./database/transactions.json","utf8"));
  arr.push({ t: Date.now(), ...tx });
  fs.writeFileSync("./database/transactions.json", JSON.stringify(arr,null,2));
  Sheets.logTx(tx).catch(()=>{});
}
function hasAnyRoleId(member, ids=[]) {
  return !!ids?.length && member.roles.cache.some(r => ids.includes(r.id));
}
function isAdmin(member, gid) {
  const g = GC.get(gid);
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    (g.ADMIN_ROLE_ID && member.roles.cache.has(g.ADMIN_ROLE_ID)) ||
    Object.keys(permsMap).some(k => hasAnyRoleId(member, permsMap[k]||[]))
  );
}
function hasPermission(member, gid, actionKey) {
  const g = GC.get(gid);
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    (g.ADMIN_ROLE_ID && member.roles.cache.has(g.ADMIN_ROLE_ID)) ||
    hasAnyRoleId(member, (permsMap[actionKey]||[]))
  );
}

async function pushLog(gid, msg) {
  const g = GC.get(gid);
  if (!g.ADMIN_LOG_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(g.ADMIN_LOG_CHANNEL_ID).catch(()=>null);
    if (ch) ch.send(String(msg));
  } catch {}
}

/* REG LIST: post or refresh */
async function updateRegList(guild) {
  if (!guild) return;
  const g = GC.get(guild.id);
  if (!g.REGLIST_CHANNEL_ID) return;

  const ch = await client.channels.fetch(g.REGLIST_CHANNEL_ID).catch(()=>null);
  if (!ch) return;

  const U = loadUsers();
  const counts = { pending:0, approved:0, rejected:0, blacklisted:0 };
  const lines = [];
  for (const [id,u] of Object.entries(U)) {
    counts[u.status] = (counts[u.status]||0)+1;
    lines.push(`• <@${id}> — ${u.name || "—"} — **${u.status || "—"}**`);
  }
  const desc = lines.length ? lines.join("\n").slice(0,3900) : "لا يوجد مستخدمون بعد.";

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("قائمة التسجيلات")
    .setDescription(desc)
    .addFields(
      { name:"قيد المراجعة", value:String(counts.pending||0), inline:true },
      { name:"مقبول", value:String(counts.approved||0), inline:true },
      { name:"مرفوض", value:String(counts.rejected||0), inline:true },
      { name:"قائمة سوداء", value:String(counts.blacklisted||0), inline:true }
    )
    .setFooter({ text:"تتحدث تلقائيًا عند أي تغيير" });

  if (g.REGLIST_MSG_ID) {
    try {
      const msg = await ch.messages.fetch(g.REGLIST_MSG_ID);
      await msg.edit({ embeds:[embed] });
      return;
    } catch { /* fallthrough */ }
  }
  const sent = await ch.send({ embeds:[embed] });
  GC.patch(guild.id, { REGLIST_MSG_ID: sent.id });
}

/* temporary stash between steps */
const regDraft = new Map();

/* finalize registration */
async function finalizeRegistration(interaction, draft) {
  const guild = interaction.guild;
  const g = GC.get(guild.id);

  if (!draft?.kind) return interaction.reply({ content:"الرجاء اختيار الحالة.", ephemeral:true });
  if (draft.kind === "فصيل" && !draft.faction) return interaction.reply({ content:"اختر الفصيل قبل الإرسال.", ephemeral:true });

  const U = loadUsers();
  const id = interaction.user.id;
  const existing = U[id];
  if (existing && existing.status !== "rejected") {
    let rsn = "لديك طلب حاليًا.";
    if (existing.status === "pending") rsn = "طلبك قيد المراجعة بالفعل.";
    else if (existing.status === "approved") rsn = "لديك حساب مفعل بالفعل.";
    else if (existing.status === "blacklisted") rsn = "تم إدراجك في القائمة السوداء.";
    return interaction.reply({ content:`لا يمكن إرسال طلب جديد: **${rsn}**`, ephemeral:true });
  }

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
    faction: draft.kind === "فصيل" ? (draft.faction || "غير محدد") : null
  };
  saveUsers(U, guild);

  if (interaction.isAnySelectMenu?.() || interaction.isButton?.())
    await interaction.update({ content:"✅ تم إرسال طلب التسجيل للمراجعة.", components:[] });
  else
    await interaction.reply({ content:"✅ تم إرسال طلب التسجيل للمراجعة.", ephemeral:true });

  client.emit("userRegistered", {
    id,
    mention:`<@${id}>`,
    tag:interaction.user.tag,
    avatar:interaction.user.displayAvatarURL({ size:256 }),
    ...U[id]
  });

  regDraft.delete(id);
}

/* interactions */
client.on("interactionCreate", async (interaction) => {
  try {
    /* Slash commands */
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (cmd) {
        await cmd.execute(interaction, {
          cfg: () => GC.get(interaction.guildId),
          users: loadUsers,
          saveUsers: (u)=>saveUsers(u, interaction.guild),
          pushTx: (tx)=>{ pushTx({ actor:interaction.user.id, ...tx }); },
          pushLog: (cli, row)=>pushLog(interaction.guildId, JSON.stringify(row)),
          updateRegList: ()=>updateRegList(interaction.guild)
        });
      }
      return;
    }

    /* post-modal status/faction */
    if (interaction.isStringSelectMenu() && interaction.customId === "reg_status_after") {
      const d = regDraft.get(interaction.user.id) || {};
      d.kind = interaction.values?.[0];
      regDraft.set(interaction.user.id, d);

      const current = interaction.message.components || [];
      const submitRow = current.find(r=>r.components?.some(c=>c.customId==="reg_submit_after"));

      if (d.kind === "فصيل") {
        const factionRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("reg_faction_after")
            .setPlaceholder("اختر الفصيل")
            .addOptions(
              { label:"شرطة", value:"شرطة" },
              { label:"جيش", value:"جيش" },
              { label:"طب", value:"طب" }
            )
        );
        const rows = [factionRow]; if (submitRow) rows.push(submitRow);
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
      if (!d) return interaction.reply({ content:"انتهت الجلسة. استخدم /register مجددًا.", ephemeral:true });
      return finalizeRegistration(interaction, d);
    }

    /* Admin buttons */
    if (interaction.isButton()) {
      const gid = interaction.guildId;
      const users = loadUsers();
      const [action, userId, extra] = interaction.customId.split("_");

      const need = (key)=>hasPermission(interaction.member, gid, key);

      if (action === "approve" || action === "reject") {
        if (!need(action)) { await interaction.deferUpdate(); return interaction.followUp({ content:"لا تملك صلاحية هذا الإجراء.", ephemeral:true }); }
        const u = users[userId];
        if (!u) { await interaction.deferUpdate(); return interaction.followUp({ content:"لا يوجد سجل.", ephemeral:true }); }
        if (u.status !== "pending") { await interaction.deferUpdate(); return interaction.followUp({ content:`الحالة الحالية: **${u.status}**`, ephemeral:true }); }

        u.status = (action === "approve") ? "approved" : "rejected";
        saveUsers(users, interaction.guild);
        await pushLog(gid, `${action === "approve" ? "✅" : "⛔"} ${interaction.user.username} ${action} ${userId}`);

        if (interaction.channelId === GC.get(gid).ADMIN_CHANNEL_ID) {
          await interaction.update({ content:`تم ${action === "approve" ? "قبول" : "رفض"} طلب ${u.name} (${userId})`, components:[] });
        } else {
          await interaction.deferUpdate();
          await interaction.followUp({ content:`${action === "approve" ? "تم القبول" : "تم الرفض"}.`, ephemeral:true });
        }
        return;
      }

      if (action === "blacklist") {
        if (!need("blacklist")) { await interaction.deferUpdate(); return interaction.followUp({ content:"لا تملك صلاحية.", ephemeral:true }); }
        const u = users[userId]; if (!u){ await interaction.deferUpdate(); return interaction.followUp({ content:"لا يوجد سجل.", ephemeral:true }); }
        u.status = "blacklisted";
        saveUsers(users, interaction.guild);
        await interaction.deferUpdate();
        return interaction.followUp({ content:`🚫 أُضيف <@${userId}> إلى القائمة السوداء.`, ephemeral:true });
      }

      if (action === "promote") {
        if (!need("promote")) { await interaction.deferUpdate(); return interaction.followUp({ content:"لا تملك صلاحية.", ephemeral:true }); }
        const ranks = GC.get(gid).ranks;
        const row = new ActionRowBuilder().addComponents(
          ranks.map(r => new ButtonBuilder().setCustomId(`setrank_${userId}_${r}`).setLabel(r).setStyle(ButtonStyle.Secondary))
        );
        await interaction.deferUpdate();
        return interaction.followUp({ content:`اختر رتبة <@${userId}>:`, components:[row], ephemeral:true });
      }

      if (action === "setrank") {
        if (!need("promote")) { await interaction.deferUpdate(); return interaction.followUp({ content:"لا تملك صلاحية.", ephemeral:true }); }
        const u = users[userId]; if (!u){ await interaction.deferUpdate(); return interaction.followUp({ content:"لا يوجد سجل.", ephemeral:true }); }
        u.rank = extra;
        saveUsers(users, interaction.guild);
        await interaction.deferUpdate();
        return interaction.followUp({ content:`📈 تم تعيين رتبة <@${userId}> إلى **${extra}**`, ephemeral:true });
      }

      if (action === "addBalance") {
        if (!need("addBalance")) { await interaction.deferUpdate(); return interaction.followUp({ content:"لا تملك صلاحية.", ephemeral:true }); }
        const modal = new ModalBuilder().setCustomId(`addBalanceModal_${userId}`).setTitle("إضافة رصيد");
        const amount = new TextInputBuilder().setCustomId("amount").setLabel(`المبلغ (${GC.get(gid).CURRENCY_SYMBOL})`).setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(amount));
        return interaction.showModal(modal);
      }

      if (action === "withdraw") {
        if (!need("addBalance")) { await interaction.deferUpdate(); return interaction.followUp({ content:"لا تملك صلاحية.", ephemeral:true }); }
        const modal = new ModalBuilder().setCustomId(`withdrawModal_${userId}`).setTitle("سحب من حساب المستخدم");
        const amount = new TextInputBuilder().setCustomId("amount").setLabel("المبلغ").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(amount));
        return interaction.showModal(modal);
      }

      if (action === "freeze" || action === "unfreeze") {
        if (!need("freeze")) { await interaction.deferUpdate(); return interaction.followUp({ content:"لا تملك صلاحية.", ephemeral:true }); }
        const u = users[userId]; if (!u){ await interaction.deferUpdate(); return interaction.followUp({ content:"لا يوجد سجل.", ephemeral:true }); }
        u.frozen = (action === "freeze");
        saveUsers(users, interaction.guild);
        await interaction.deferUpdate();
        return interaction.followUp({ content:`تم ${u.frozen ? "تجميد" : "إلغاء تجميد"} حساب <@${userId}>.`, ephemeral:true });
      }

      if (action === "fees") {
        if (!need("editFee")) { await interaction.deferUpdate(); return interaction.followUp({ content:"لا تملك صلاحية.", ephemeral:true }); }
        const modal = new ModalBuilder().setCustomId("feesModal").setTitle("تعديل الرسوم البنكية");
        const dep = new TextInputBuilder().setCustomId("deposit").setLabel("الإيداع %").setStyle(TextInputStyle.Short).setRequired(true);
        const trn = new TextInputBuilder().setCustomId("transfer").setLabel("التحويل %").setStyle(TextInputStyle.Short).setRequired(true);
        const wdr = new TextInputBuilder().setCustomId("withdraw").setLabel("السحب %").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(dep),
          new ActionRowBuilder().addComponents(trn),
          new ActionRowBuilder().addComponents(wdr)
        );
        return interaction.showModal(modal);
      }
    }

    /* Modals */
    if (interaction.isModalSubmit() && interaction.customId.startsWith("addBalanceModal_")) {
      const gid = interaction.guildId;
      if (!hasPermission(interaction.member, gid, "addBalance")) return interaction.reply({ content:"لا تملك صلاحية.", ephemeral:true });

      const userId = interaction.customId.split("_")[1];
      const users = loadUsers();
      const u = users[userId];
      if (!u) return interaction.reply({ content:"لا يوجد سجل.", ephemeral:true });

      const amount = parseFloat(interaction.fields.getTextInputValue("amount"));
      if (isNaN(amount) || amount <= 0) return interaction.reply({ content:"أدخل مبلغًا صحيحًا.", ephemeral:true });

      u.balance = (u.balance || 0) + amount;
      saveUsers(users, interaction.guild);
      pushTx({ type:"admin_add", to:userId, amount, actor:interaction.user.id });
      return interaction.reply({ content:`✅ أُضيف ${amount}${GC.get(gid).CURRENCY_SYMBOL} إلى <@${userId}>`, ephemeral:true });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("withdrawModal_")) {
      const gid = interaction.guildId;
      if (!hasPermission(interaction.member, gid, "addBalance")) return interaction.reply({ content:"لا تملك صلاحية.", ephemeral:true });

      const userId = interaction.customId.split("_")[1];
      const users = loadUsers();
      const u = users[userId];
      if (!u) return interaction.reply({ content:"لا يوجد سجل.", ephemeral:true });

      const amount = parseFloat(interaction.fields.getTextInputValue("amount"));
      if (isNaN(amount) || amount <= 0) return interaction.reply({ content:"أدخل مبلغًا صحيحًا.", ephemeral:true });

      const fee = Math.floor((amount * (GC.get(gid).fees.WITHDRAW_FEE || 0)) / 100);
      const total = amount + fee;
      if ((u.balance || 0) < total) return interaction.reply({ content:"رصيد غير كافٍ.", ephemeral:true });

      u.balance -= total;
      saveUsers(users, interaction.guild);
      pushTx({ type:"admin_withdraw", from:userId, amount, fee, actor:interaction.user.id });
      return interaction.reply({ content:`💸 تم سحب ${amount}${GC.get(gid).CURRENCY_SYMBOL} (رسوم ${fee}).`, ephemeral:true });
    }

    if (interaction.isModalSubmit() && interaction.customId === "feesModal") {
      const gid = interaction.guildId;
      if (!hasPermission(interaction.member, gid, "editFee")) return interaction.reply({ content:"لا تملك صلاحية.", ephemeral:true });
      try {
        const dep = Number(interaction.fields.getTextInputValue("deposit"));
        const trn = Number(interaction.fields.getTextInputValue("transfer"));
        const wdr = Number(interaction.fields.getTextInputValue("withdraw"));
        for (const v of [dep,trn,wdr]) if (!Number.isFinite(v) || v<0 || v>100) return interaction.reply({ content:"بين 0 و 100.", ephemeral:true });
        const patch = { fees:{ DEPOSIT_FEE:dep, TRANSFER_FEE:trn, WITHDRAW_FEE:wdr } };
        GC.patch(gid, patch);
        return interaction.reply({ content:`تم تحديث الرسوم لهذا السيرفر.`, ephemeral:true });
      } catch { return interaction.reply({ content:"خطأ أثناء تحديث الرسوم.", ephemeral:true }); }
    }

    if (interaction.isModalSubmit() && interaction.customId === "registerModal") {
      const g = GC.get(interaction.guildId);
      if (g.REGISTER_CHANNEL_ID && interaction.channelId !== g.REGISTER_CHANNEL_ID)
        return interaction.reply({ content:`استعمل الأمر داخل <#${g.REGISTER_CHANNEL_ID}>.`, ephemeral:true });

      const name = interaction.fields.getTextInputValue("name").trim();
      const country = interaction.fields.getTextInputValue("country").trim();
      const age = parseInt(interaction.fields.getTextInputValue("age").trim(),10);
      const birth = interaction.fields.getTextInputValue("birth").trim();
      const income = parseInt(interaction.fields.getTextInputValue("income").trim(),10);

      if (!name || !country || !Number.isFinite(age) || age<16 || age>65 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birth) || !Number.isFinite(income) || income<=0)
        return interaction.reply({ content:"بيانات غير صحيحة.", ephemeral:true });

      if (income < (g.MIN_DEPOSIT||0))
        return interaction.reply({ content:`الحد الأدنى للدخل ${g.MIN_DEPOSIT} ${g.CURRENCY_SYMBOL}.`, ephemeral:true });

      regDraft.set(interaction.user.id, { name, country, age, birth, income });

      const statusSelect = new StringSelectMenuBuilder()
        .setCustomId("reg_status_after").setPlaceholder("اختر الحالة")
        .addOptions({label:"مدني", value:"مدني"},{label:"عصابة", value:"عصابة"},{label:"فصيل", value:"فصيل"});
      const confirmBtn = new ButtonBuilder().setCustomId("reg_submit_after").setLabel("إرسال الطلب").setStyle(ButtonStyle.Primary);
      return interaction.reply({
        content:"📋 تم استلام النموذج. اختر **الحالة**.\nإذا اخترت **فصيل** سيظهر اختيار الفصيل ثم الإرسال تلقائيًا.",
        components:[ new ActionRowBuilder().addComponents(statusSelect), new ActionRowBuilder().addComponents(confirmBtn) ],
        ephemeral:true
      });
    }
  } catch (err) {
    console.error("interaction error:", err);
  }
});

/* Review card sender */
client.on("userRegistered", async (u) => {
  try {
    const gid = (await client.users.fetch(u.id)).mutualGuilds?.first()?.id || null;
    const g = gid ? GC.get(gid) : null;
    const ch = g ? await client.channels.fetch(g.ADMIN_CHANNEL_ID).catch(()=>null) : null;
    if (!ch) return;

    const embed = new EmbedBuilder()
      .setColor(0x57f287).setTitle("طلب تسجيل جديد ✏️").setThumbnail(u.avatar)
      .setDescription(`**مستخدم جديد:** ${u.mention}`)
      .addFields(
        { name:"الاسم", value:String(u.name||"—"), inline:true },
        { name:"البلد", value:String(u.country||"—"), inline:true },
        { name:"العمر", value:String(u.age??"—"), inline:true },
        { name:"تاريخ الميلاد", value:String(u.birth||"—"), inline:true },
        { name:"الدخل", value:String(u.income??0), inline:true },
        { name:"الرتبة", value:String(u.rank||"—"), inline:true },
        { name:"الحالة", value:String(u.status||"—"), inline:true },
        { name:"النوع", value:String(u.kind||"—"), inline:true },
        { name:"فصيل", value:String(u.faction||"—"), inline:true },
        { name:"ID", value:String(u.id), inline:false }
      )
      .setFooter({ text:"يرجى المراجعة ثم القبول/الرفض" });

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve_${u.id}`).setLabel("موافقة").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject_${u.id}`).setLabel("رفض").setStyle(ButtonStyle.Danger)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`addBalance_${u.id}`).setLabel("إضافة رصيد").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`withdraw_${u.id}`).setLabel("سحب").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`promote_${u.id}`).setLabel("ترقية").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`fees`).setLabel("تعديل الرسوم").setStyle(ButtonStyle.Secondary)
    );
    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`freeze_${u.id}`).setLabel("تجميد").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`blacklist_${u.id}`).setLabel("قائمة سوداء").setStyle(ButtonStyle.Danger)
    );

    await ch.send({ embeds:[embed], components:[row1,row2,row3] });
  } catch (e) { console.error("userRegistered:", e); }
});

client.login(process.env.TOKEN);
