const {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
  Events
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const INFECTED_ROLE_ID = '1479979280816668862';
const VANITY_TEXT = '.gg/outbreak99';
const LOG_CHANNEL_ID = '1479969894849314997';
const BOT_COMMAND_CHANNEL_ID = '1479995203938156614';
const EVENT_CHANNEL_ID = '1479995203938156614';

const DATA_FILE = path.join(__dirname, 'infection-data.json');

const biteCooldown = new Map();
const COOLDOWN_TIME = 60000; // 60 seconds

let activeOutbreak = null;
let activeRaid = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { players: {} };
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    console.error('Failed to read infection-data.json:', error);
    return { players: {} };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hoursToMs(hours) {
  return hours * 60 * 60 * 1000;
}

function formatMs(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createDefaultPlayer() {
  return {
    infected: false,
    health: 100,
    hunger: 100,
    bites: 0,
    successfulInfections: 0,
    failedBites: 0,
    timesCured: 0,
    outbreaksSurvived: 0,
    outbreaksInfected: 0,
    huntsWon: 0,
    scavenges: 0,
    raidsJoined: 0,
    raidsWon: 0,
    dailyClaims: 0,
    lastDailyAt: 0,
    inventory: {
      cure: 0,
      weapon: 0,
      'protective-gear': 0,
      antivirus: 0,
      food: 0,
      medkit: 0,
      'biohazard-suit': 0,
      mutation: 0,
      'super-cure': 0,
      flamethrower: 0
    },
    effects: {
      weaponBoost: false,
      protection: false,
      antivirusBoost: false,
      foodBoost: false,
      mutationBoost: false,
      biohazardSuitCharges: 0,
      flamethrowerCharges: 0
    }
  };
}

function ensurePlayer(data, userId) {
  if (!data.players[userId]) {
    data.players[userId] = createDefaultPlayer();
  }

  const player = data.players[userId];
  const defaults = createDefaultPlayer();

  for (const [key, value] of Object.entries(defaults)) {
    if (typeof player[key] === 'undefined' && key !== 'inventory' && key !== 'effects') {
      player[key] = value;
    }
  }

  if (!player.inventory) {
    player.inventory = defaults.inventory;
  }

  if (!player.effects) {
    player.effects = defaults.effects;
  }

  for (const [key, value] of Object.entries(defaults.inventory)) {
    if (typeof player.inventory[key] !== 'number') player.inventory[key] = value;
  }

  for (const [key, value] of Object.entries(defaults.effects)) {
    if (typeof value === 'boolean' && typeof player.effects[key] !== 'boolean') {
      player.effects[key] = value;
    }
    if (typeof value === 'number' && typeof player.effects[key] !== 'number') {
      player.effects[key] = value;
    }
  }

  player.health = clamp(player.health, 0, 100);
  player.hunger = clamp(player.hunger, 0, 100);

  return player;
}

function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, '');
}

function getCustomStatus(presence) {
  if (!presence) return '';

  const custom = presence.activities.find(
    activity => activity.type === ActivityType.Custom
  );

  return custom?.state || '';
}

function hasVanity(presence) {
  const status = normalize(getCustomStatus(presence));
  const vanity = normalize(VANITY_TEXT);
  return status.includes(vanity);
}

function getInventoryText(player) {
  return [
    `💉 Cure: ${player.inventory.cure}`,
    `🔫 Weapon: ${player.inventory.weapon}`,
    `🛡️ Protective Gear: ${player.inventory['protective-gear']}`,
    `🧪 Antivirus: ${player.inventory.antivirus}`,
    `🥫 Food: ${player.inventory.food}`,
    `🩹 Medkit: ${player.inventory.medkit}`,
    `☣️ Biohazard Suit: ${player.inventory['biohazard-suit']}`,
    `🧬 Mutation: ${player.inventory.mutation}`,
    `✨ Super Cure: ${player.inventory['super-cure']}`,
    `🔥 Flamethrower: ${player.inventory.flamethrower}`
  ].join('\n');
}

function getSurvivorRank(player) {
  const score =
    player.outbreaksSurvived +
    player.raidsWon +
    player.huntsWon +
    player.timesCured;

  if (score >= 40) return '🔥 Legend';
  if (score >= 25) return '🛡️ Guardian';
  if (score >= 15) return '🏹 Hunter';
  if (score >= 8) return '🪖 Veteran';
  return '🧍 Survivor';
}

function getZombieRank(player) {
  const score = player.successfulInfections;

  if (score >= 50) return '👑 Alpha Zombie';
  if (score >= 30) return '🧬 Mutation Host';
  if (score >= 15) return '☣️ Spreader';
  if (score >= 5) return '🧟 Carrier';
  return '🦠 Fresh Infected';
}

async function sendVanityLog(member, added) {
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(added ? 'Vanity Detected' : 'Vanity Removed')
      .setDescription(
        added
          ? `${member} added (${VANITY_TEXT}) to their status`
          : `${member} removed (${VANITY_TEXT}) from their status`
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Log error:', err);
  }
}

async function addInfectedRole(guild, userId) {
  try {
    const member = await guild.members.fetch(userId);
    if (member) {
      await member.roles.add(INFECTED_ROLE_ID);
    }
  } catch (error) {
    console.error('Failed to add infected role:', error);
  }
}

async function removeInfectedRole(guild, userId) {
  try {
    const member = await guild.members.fetch(userId);
    if (member) {
      await member.roles.remove(INFECTED_ROLE_ID);
    }
  } catch (error) {
    console.error('Failed to remove infected role:', error);
  }
}

function useProtection(player) {
  if (player.effects.biohazardSuitCharges > 0) {
    player.effects.biohazardSuitCharges -= 1;
    return 'biohazard';
  }

  if (player.effects.protection) {
    player.effects.protection = false;
    return 'gear';
  }

  return null;
}

async function infectUser(guild, data, userId, healthLoss = 20, hungerLoss = 10) {
  const player = ensurePlayer(data, userId);
  if (player.infected) return false;

  const protectionUsed = useProtection(player);
  if (protectionUsed) return protectionUsed;

  player.infected = true;
  player.health = clamp(player.health - healthLoss, 0, 100);
  player.hunger = clamp(player.hunger - hungerLoss, 0, 100);
  await addInfectedRole(guild, userId);
  return true;
}

async function startOutbreakEvent() {
  try {
    if (activeOutbreak) return;

    const guild = client.guilds.cache.first();
    if (!guild) return;

    const channel = guild.channels.cache.get(EVENT_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    activeOutbreak = {
      channelId: channel.id,
      startedAt: Date.now(),
      endsAt: Date.now() + 30000,
      hiders: new Set()
    };

    const embed = new EmbedBuilder()
      .setTitle('☣️ OUTBREAK ALERT')
      .setDescription('A zombie horde breached the perimeter.\nUse **/hide** within **30 seconds** or risk infection.')
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    setTimeout(async () => {
      try {
        if (!activeOutbreak) return;

        const data = loadData();
        await guild.members.fetch();

        const infectedNow = [];
        const survivedNow = [];

        for (const member of guild.members.cache.values()) {
          if (member.user.bot) continue;

          const player = ensurePlayer(data, member.user.id);
          const hid = activeOutbreak.hiders.has(member.user.id);

          if (hid) {
            player.outbreaksSurvived += 1;
            player.hunger = clamp(player.hunger - 5, 0, 100);
            survivedNow.push(member.user.id);
            continue;
          }

          const result = await infectUser(guild, data, member.user.id, 15, 10);

          if (result === true) {
            player.outbreaksInfected += 1;
            infectedNow.push(member.user.id);
          } else {
            player.outbreaksSurvived += 1;
            survivedNow.push(member.user.id);
          }
        }

        saveData(data);

        const resultEmbed = new EmbedBuilder()
          .setTitle('☣️ OUTBREAK ENDED')
          .addFields(
            {
              name: '🧍 Survived',
              value: survivedNow.length ? survivedNow.map(id => `<@${id}>`).slice(0, 20).join(', ') : 'Nobody',
              inline: false
            },
            {
              name: '🧟 Newly Infected',
              value: infectedNow.length ? infectedNow.map(id => `<@${id}>`).slice(0, 20).join(', ') : 'Nobody',
              inline: false
            }
          )
          .setTimestamp();

        const resultChannel = guild.channels.cache.get(activeOutbreak.channelId);
        if (resultChannel && resultChannel.isTextBased()) {
          await resultChannel.send({ embeds: [resultEmbed] });
        }
      } catch (error) {
        console.error('Outbreak event error:', error);
      } finally {
        activeOutbreak = null;
      }
    }, 30000);
  } catch (error) {
    console.error('Failed to start outbreak event:', error);
    activeOutbreak = null;
  }
}

async function startRaidEvent() {
  try {
    if (activeRaid) return;

    const guild = client.guilds.cache.first();
    if (!guild) return;

    const channel = guild.channels.cache.get(EVENT_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    const bossHp = randomInt(120, 220);

    activeRaid = {
      channelId: channel.id,
      startedAt: Date.now(),
      endsAt: Date.now() + 30000,
      fighters: new Set(),
      bossHp
    };

    const embed = new EmbedBuilder()
      .setTitle('👑 ZOMBIE BOSS RAID')
      .setDescription(`A massive mutated zombie appeared.\nUse **/raid** within **30 seconds** to join the fight.\nBoss HP: **${bossHp}**`)
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    setTimeout(async () => {
      try {
        if (!activeRaid) return;

        const data = loadData();
        const fighters = [...activeRaid.fighters];
        const resultChannel = guild.channels.cache.get(activeRaid.channelId);

        let totalDamage = 0;
        const fighterMentions = [];

        for (const userId of fighters) {
          const player = ensurePlayer(data, userId);
          player.raidsJoined += 1;

          let damage = randomInt(10, 30);

          if (player.inventory.weapon > 0 || player.effects.weaponBoost) {
            damage += 10;
          }

          if (player.effects.mutationBoost) {
            damage += 20;
            player.effects.mutationBoost = false;
          }

          player.hunger = clamp(player.hunger - 10, 0, 100);
          totalDamage += damage;
          fighterMentions.push(`<@${userId}>`);
        }

        const bossDefeated = fighters.length > 0 && totalDamage >= activeRaid.bossHp;

        if (bossDefeated) {
          for (const userId of fighters) {
            const player = ensurePlayer(data, userId);
            player.raidsWon += 1;
            player.inventory.food += 1;
            if (Math.random() < 0.5) player.inventory.medkit += 1;
            if (Math.random() < 0.2) player.inventory.weapon += 1;
          }

          saveData(data);

          if (resultChannel && resultChannel.isTextBased()) {
            const embedWin = new EmbedBuilder()
              .setTitle('⚔️ RAID WON')
              .setDescription(
                `${fighterMentions.length ? fighterMentions.join(', ') : 'Nobody'} defeated the boss zombie.\nDamage dealt: **${totalDamage}** / **${activeRaid.bossHp}**`
              )
              .addFields({
                name: '🎁 Rewards',
                value: '🥫 Food x1 for all fighters\n🩹 Chance for Medkit\n🔫 Chance for Weapon',
                inline: false
              })
              .setTimestamp();

            await resultChannel.send({ embeds: [embedWin] });
          }
        } else {
          const infectedNow = [];

          for (const userId of fighters) {
            const player = ensurePlayer(data, userId);
            const result = await infectUser(guild, data, userId, 20, 15);
            if (result === true) infectedNow.push(`<@${userId}>`);
          }

          saveData(data);

          if (resultChannel && resultChannel.isTextBased()) {
            const embedLose = new EmbedBuilder()
              .setTitle('☣️ RAID FAILED')
              .setDescription(
                `The boss zombie crushed the survivors.\nDamage dealt: **${totalDamage}** / **${activeRaid.bossHp}**`
              )
              .addFields({
                name: '🧟 Infected',
                value: infectedNow.length ? infectedNow.join(', ') : 'Nobody',
                inline: false
              })
              .setTimestamp();

            await resultChannel.send({ embeds: [embedLose] });
          }
        }
      } catch (error) {
        console.error('Raid event error:', error);
      } finally {
        activeRaid = null;
      }
    }, 30000);
  } catch (error) {
    console.error('Failed to start raid event:', error);
    activeRaid = null;
  }
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  setInterval(() => {
    if (Math.random() < 0.35) {
      startOutbreakEvent();
    }
  }, 20 * 60 * 1000);

  setInterval(() => {
    if (Math.random() < 0.30) {
      startRaidEvent();
    }
  }, 25 * 60 * 1000);
});

client.on('presenceUpdate', async (oldPresence, newPresence) => {
  const member = newPresence?.member || oldPresence?.member;
  if (!member || member.user.bot) return;

  const hadVanity = hasVanity(oldPresence);
  const hasNow = hasVanity(newPresence);

  if (!hadVanity && hasNow) {
    await sendVanityLog(member, true);
  }

  if (hadVanity && !hasNow) {
    await sendVanityLog(member, false);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.channelId !== BOT_COMMAND_CHANNEL_ID) {
    return interaction.reply({
      content: '❌ You can only use Patient Zero commands in <#1479995203938156614>.',
      ephemeral: true
    });
  }

  const data = loadData();

  if (interaction.commandName === 'bite') {
    const target = interaction.options.getUser('target');
    const attacker = ensurePlayer(data, interaction.user.id);

    const activeCooldown = attacker.effects.foodBoost ? Math.floor(COOLDOWN_TIME / 2) : COOLDOWN_TIME;
    const lastBite = biteCooldown.get(interaction.user.id);

    if (lastBite && Date.now() - lastBite < activeCooldown) {
      const remaining = Math.ceil((activeCooldown - (Date.now() - lastBite)) / 1000);
      return interaction.reply({
        content: `⏳ You must wait ${remaining}s before biting again.`,
        ephemeral: true
      });
    }

    if (!target) {
      return interaction.reply({ content: 'Choose someone to bite.', ephemeral: true });
    }

    if (target.bot) {
      return interaction.reply({ content: 'You cannot infect bots.', ephemeral: true });
    }

    if (target.id === interaction.user.id) {
      return interaction.reply({ content: '🧟 You cannot bite yourself.', ephemeral: true });
    }

    if (attacker.hunger < 10) {
      return interaction.reply({
        content: '🥫 You are too hungry to bite. Use food first.',
        ephemeral: true
      });
    }

    biteCooldown.set(interaction.user.id, Date.now());

    const victim = ensurePlayer(data, target.id);
    attacker.bites += 1;
    attacker.hunger = clamp(attacker.hunger - 10, 0, 100);

    if (attacker.effects.foodBoost) {
      attacker.effects.foodBoost = false;
    }

    if (victim.infected) {
      saveData(data);
      return interaction.reply(`🧟 ${target} is already infected.`);
    }

    const protectionUsed = useProtection(victim);
    if (protectionUsed === 'biohazard') {
      saveData(data);
      return interaction.reply(`☣️ ${target}'s Biohazard Suit blocked the infection from ${interaction.user}!`);
    }

    if (protectionUsed === 'gear') {
      saveData(data);
      return interaction.reply(`🛡️ ${target}'s protective gear blocked the infection from ${interaction.user}!`);
    }

    let successChance = 0.5;

    if (attacker.effects.weaponBoost) {
      successChance = 0.7;
      attacker.effects.weaponBoost = false;
    }

    if (attacker.effects.mutationBoost) {
      successChance = 1.0;
      attacker.effects.mutationBoost = false;
    }

    if (attacker.effects.flamethrowerCharges > 0) {
      successChance = 1.0;
      attacker.effects.flamethrowerCharges -= 1;
    }

    const success = Math.random() < successChance;

    if (!success) {
      attacker.failedBites += 1;
      saveData(data);
      return interaction.reply(`🩸 ${target} fought off the infection from ${interaction.user}... this time.`);
    }

    victim.infected = true;
    victim.health = clamp(victim.health - 20, 0, 100);
    attacker.successfulInfections += 1;

    await addInfectedRole(interaction.guild, target.id);

    saveData(data);
    return interaction.reply(`🧟 ${target} has turned after an attack from ${interaction.user}!`);
  }

  if (interaction.commandName === 'cure') {
    const player = ensurePlayer(data, interaction.user.id);

    if (!player.infected) {
      saveData(data);
      return interaction.reply({
        content: '✅ Your blood is still clean... for now.',
        ephemeral: true
      });
    }

    let cureChance = 0.35;

    if (player.effects.antivirusBoost) {
      cureChance = 0.65;
      player.effects.antivirusBoost = false;
    }

    const cured = Math.random() < cureChance;

    if (!cured) {
      player.health = clamp(player.health - 10, 0, 100);
      saveData(data);
      return interaction.reply(`☣️ The infection spread deeper. The cure attempt failed.`);
    }

    player.infected = false;
    player.timesCured += 1;
    player.health = clamp(player.health + 10, 0, 100);

    await removeInfectedRole(interaction.guild, interaction.user.id);

    saveData(data);
    return interaction.reply(`💉 The antidote worked. ${interaction.user} is human again.`);
  }

  if (interaction.commandName === 'hide') {
    if (!activeOutbreak) {
      return interaction.reply({
        content: '🫥 There is no active outbreak right now.',
        ephemeral: true
      });
    }

    if (Date.now() > activeOutbreak.endsAt) {
      return interaction.reply({
        content: '⏰ You were too late to hide.',
        ephemeral: true
      });
    }

    activeOutbreak.hiders.add(interaction.user.id);

    return interaction.reply({
      content: '🫥 You slipped into the shadows and avoided the horde.',
      ephemeral: true
    });
  }

  if (interaction.commandName === 'raid') {
    if (!activeRaid) {
      return interaction.reply({
        content: '⚔️ There is no active boss raid right now.',
        ephemeral: true
      });
    }

    if (Date.now() > activeRaid.endsAt) {
      return interaction.reply({
        content: '⏰ You were too late to join the raid.',
        ephemeral: true
      });
    }

    activeRaid.fighters.add(interaction.user.id);
    return interaction.reply({
      content: '⚔️ You joined the fight against the boss zombie.',
      ephemeral: true
    });
  }

  if (interaction.commandName === 'daily') {
    const player = ensurePlayer(data, interaction.user.id);
    const now = Date.now();
    const cooldown = hoursToMs(24);

    if (player.lastDailyAt && now - player.lastDailyAt < cooldown) {
      return interaction.reply({
        content: `📦 You already claimed today's supply drop.\nCome back in ${formatMs(cooldown - (now - player.lastDailyAt))}.`,
        ephemeral: true
      });
    }

    player.lastDailyAt = now;
    player.dailyClaims += 1;

    const rewards = [];
    const foodAmount = randomInt(1, 3);
    player.inventory.food += foodAmount;
    rewards.push(`🥫 Food x${foodAmount}`);

    if (Math.random() < 0.8) {
      player.inventory.medkit += 1;
      rewards.push('🩹 Medkit x1');
    }

    if (Math.random() < 0.7) {
      player.inventory.antivirus += 1;
      rewards.push('🧪 Antivirus x1');
    }

    if (Math.random() < 0.4) {
      player.inventory.weapon += 1;
      rewards.push('🔫 Weapon x1');
    }

    if (Math.random() < 0.15) {
      player.inventory['biohazard-suit'] += 1;
      rewards.push('☣️ Biohazard Suit x1');
    }

    if (Math.random() < 0.10) {
      player.inventory['super-cure'] += 1;
      rewards.push('✨ Super Cure x1');
    }

    saveData(data);

    const embed = new EmbedBuilder()
      .setTitle('📦 Daily Supply Drop')
      .setDescription(rewards.join('\n'))
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'scavenge') {
    const location = interaction.options.getString('location');
    const player = ensurePlayer(data, interaction.user.id);

    if (player.hunger < 10) {
      return interaction.reply({
        content: '🥫 You are too hungry to scavenge.',
        ephemeral: true
      });
    }

    player.scavenges += 1;
    player.hunger = clamp(player.hunger - 12, 0, 100);

    const locationTables = {
      hospital: [
        { key: 'medkit', text: '🩹 You searched an abandoned hospital and found a medkit.' },
        { key: 'cure', text: '💉 You found a cure locked in an emergency cabinet.' },
        { key: 'antivirus', text: '🧪 You recovered antivirus supplies.' },
        { key: null, text: '💀 The hospital was stripped clean.' }
      ],
      'police-station': [
        { key: 'weapon', text: '🔫 You found a weapon in the armory.' },
        { key: 'protective-gear', text: '🛡️ You found protective gear in the locker room.' },
        { key: null, text: '💀 The station was already looted.' }
      ],
      bunker: [
        { key: 'biohazard-suit', text: '☣️ LEGENDARY! You discovered a Biohazard Suit in the bunker.' },
        { key: 'super-cure', text: '✨ LEGENDARY! You found a Super Cure in cryo-storage.' },
        { key: 'mutation', text: '🧬 LEGENDARY! You uncovered a Mutation vial.' },
        { key: null, text: '💀 The bunker was sealed shut and empty.' }
      ],
      mall: [
        { key: 'food', text: '🥫 You scavenged a food court and found food rations.' },
        { key: 'medkit', text: '🩹 You found first aid supplies in a shop.' },
        { key: 'weapon', text: '🔫 You found a makeshift weapon in the maintenance hall.' },
        { key: null, text: '💀 The mall had nothing useful left.' }
      ]
    };

    const roll = Math.random();

    if (roll < 0.18) {
      const result = await infectUser(interaction.guild, data, interaction.user.id, 15, 10);
      saveData(data);

      if (result === true) {
        return interaction.reply(`☣️ A hidden zombie attacked while you scavenged the ${location}. You were infected!`);
      }

      return interaction.reply(`🛡️ Something lunged at you in the ${location}, but your protection saved you.`);
    }

    const found = randomChoice(locationTables[location] || locationTables.mall);

    if (found.key) {
      player.inventory[found.key] += 1;
    }

    saveData(data);
    return interaction.reply(found.text);
  }

  if (interaction.commandName === 'hunt') {
    const player = ensurePlayer(data, interaction.user.id);

    if (player.hunger < 10) {
      return interaction.reply({
        content: '🥫 You are too hungry to hunt.',
        ephemeral: true
      });
    }

    player.hunger = clamp(player.hunger - 10, 0, 100);

    const roll = Math.random();

    if (roll < 0.20) {
      const result = await infectUser(interaction.guild, data, interaction.user.id, 20, 10);
      saveData(data);

      if (result === true) {
        return interaction.reply('☣️ A wandering zombie bit you during the hunt. You are now infected!');
      }

      return interaction.reply('🛡️ A zombie ambushed you, but your gear absorbed the attack.');
    }

    if (roll < 0.60) {
      player.huntsWon += 1;
      if (Math.random() < 0.5) player.inventory.food += 1;
      if (Math.random() < 0.35) player.inventory.weapon += 1;
      saveData(data);
      return interaction.reply('🔦 You tracked down a zombie and won the fight. You recovered useful supplies.');
    }

    player.health = clamp(player.health - 10, 0, 100);
    saveData(data);
    return interaction.reply('🩸 The hunt went badly. You escaped, but lost health.');
  }

  if (interaction.commandName === 'status') {
    const player = ensurePlayer(data, interaction.user.id);
    saveData(data);

    const embed = new EmbedBuilder()
      .setTitle(`🧬 ${interaction.user.username}'s Status`)
      .addFields(
        { name: 'Condition', value: player.infected ? '🧟 Infected' : '🧍 Survivor', inline: false },
        { name: '❤️ Health', value: String(player.health), inline: true },
        { name: '🥫 Hunger', value: String(player.hunger), inline: true },
        { name: '🛡 Survivor Rank', value: getSurvivorRank(player), inline: true },
        { name: '☣️ Zombie Rank', value: getZombieRank(player), inline: true },
        { name: '🦠 Successful Infections', value: String(player.successfulInfections), inline: true },
        { name: '☣️ Outbreaks Survived', value: String(player.outbreaksSurvived), inline: true },
        { name: '⚔️ Raids Won', value: String(player.raidsWon), inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'leaderboard') {
    const entries = Object.entries(data.players);

    if (entries.length === 0) {
      return interaction.reply('Nobody has any stats yet.');
    }

    const sorted = entries
      .sort((a, b) => b[1].successfulInfections - a[1].successfulInfections)
      .slice(0, 10);

    const lines = sorted.map(([userId, stats], index) => {
      const status = stats.infected ? '🧟' : '🧍';
      return `**${index + 1}.** <@${userId}> — ${stats.successfulInfections} infections ${status}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('🏆 Zombie Leaderboard')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Ranked by successful infections' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'loot') {
    const player = ensurePlayer(data, interaction.user.id);

    const lootTable = [
      { key: 'cure', message: '💉 You scavenged a cure from the ruins.' },
      { key: 'weapon', message: '🔫 You found a weapon hidden in the debris.' },
      { key: 'protective-gear', message: '🛡️ You recovered protective gear.' },
      { key: 'antivirus', message: '🧪 You found antivirus supplies.' },
      { key: 'food', message: '🥫 You found food rations.' },
      { key: 'medkit', message: '🩹 You discovered a medkit.' },
      { key: 'biohazard-suit', message: '☣️ LEGENDARY! You found a Biohazard Suit!' },
      { key: 'mutation', message: '🧬 LEGENDARY! You found a Mutation vial!' },
      { key: 'super-cure', message: '✨ LEGENDARY! You found a Super Cure!' },
      { key: 'flamethrower', message: '🔥 LEGENDARY! You found a Flamethrower!' },
      { key: null, message: '💀 You searched the ruins but found nothing useful.' }
    ];

    const found = randomChoice(lootTable);

    if (found.key) {
      player.inventory[found.key] += 1;
    }

    player.hunger = clamp(player.hunger - 5, 0, 100);
    saveData(data);

    return interaction.reply(`🎒 ${interaction.user} searched for supplies...\n${found.message}`);
  }

  if (interaction.commandName === 'inventory') {
    const player = ensurePlayer(data, interaction.user.id);
    saveData(data);

    const embed = new EmbedBuilder()
      .setTitle(`🎒 ${interaction.user.username}'s Inventory`)
      .setDescription(getInventoryText(player))
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'use') {
    const item = interaction.options.getString('item');
    const player = ensurePlayer(data, interaction.user.id);

    if (!player.inventory[item] || player.inventory[item] <= 0) {
      return interaction.reply({
        content: `❌ You do not have any ${item}.`,
        ephemeral: true
      });
    }

    if (item === 'cure') {
      if (!player.infected) {
        return interaction.reply({
          content: '✅ You are not infected, so you do not need to use a cure.',
          ephemeral: true
        });
      }

      player.inventory.cure -= 1;
      player.infected = false;
      player.timesCured += 1;
      await removeInfectedRole(interaction.guild, interaction.user.id);

      saveData(data);
      return interaction.reply(`💉 ${interaction.user} used a cure and is no longer infected!`);
    }

    if (item === 'weapon') {
      player.inventory.weapon -= 1;
      player.effects.weaponBoost = true;
      saveData(data);
      return interaction.reply(`🔫 ${interaction.user} equipped a weapon. Your next bite has a higher infection chance.`);
    }

    if (item === 'protective-gear') {
      player.inventory['protective-gear'] -= 1;
      player.effects.protection = true;
      saveData(data);
      return interaction.reply(`🛡️ ${interaction.user} equipped protective gear. The next infection attempt against you will be blocked.`);
    }

    if (item === 'antivirus') {
      player.inventory.antivirus -= 1;
      player.effects.antivirusBoost = true;
      saveData(data);
      return interaction.reply(`🧪 ${interaction.user} used antivirus supplies. Your next /cure has a better chance.`);
    }

    if (item === 'food') {
      player.inventory.food -= 1;
      player.effects.foodBoost = true;
      player.hunger = clamp(player.hunger + 25, 0, 100);
      saveData(data);
      return interaction.reply(`🥫 ${interaction.user} used food rations. Hunger restored and your next bite cooldown is reduced.`);
    }

    if (item === 'medkit') {
      player.inventory.medkit -= 1;
      player.health = clamp(player.health + 35, 0, 100);
      saveData(data);
      return interaction.reply(`🩹 ${interaction.user} used a medkit and restored health.`);
    }

    if (item === 'biohazard-suit') {
      player.inventory['biohazard-suit'] -= 1;
      player.effects.biohazardSuitCharges += 3;
      saveData(data);
      return interaction.reply(`☣️ ${interaction.user} equipped a Biohazard Suit. It will block the next 3 infection attempts.`);
    }

    if (item === 'mutation') {
      player.inventory.mutation -= 1;
      player.effects.mutationBoost = true;
      saveData(data);
      return interaction.reply(`🧬 ${interaction.user} used Mutation. Your next bite is guaranteed to infect.`);
    }

    if (item === 'super-cure') {
      player.inventory['super-cure'] -= 1;
      player.infected = false;
      player.timesCured += 1;
      player.health = 100;
      player.hunger = 100;
      await removeInfectedRole(interaction.guild, interaction.user.id);
      saveData(data);
      return interaction.reply(`✨ ${interaction.user} used a Super Cure. Infection removed and all stats restored!`);
    }

    if (item === 'flamethrower') {
      player.inventory.flamethrower -= 1;
      player.effects.flamethrowerCharges += 3;
      saveData(data);
      return interaction.reply(`🔥 ${interaction.user} armed a Flamethrower. Your next 3 bites are guaranteed to infect.`);
    }
  }

  if (interaction.commandName === 'serverstats') {
    const players = Object.values(data.players);
    const infected = players.filter(player => player.infected).length;
    const survivors = players.filter(player => !player.infected).length;
    const total = infected + survivors;

    const avgHealth = total
      ? Math.round(players.reduce((sum, p) => sum + (p.health || 0), 0) / total)
      : 0;

    const avgHunger = total
      ? Math.round(players.reduce((sum, p) => sum + (p.hunger || 0), 0) / total)
      : 0;

    const embed = new EmbedBuilder()
      .setTitle('☣️ Outbreak Statistics')
      .addFields(
        { name: '🧟 Infected', value: String(infected), inline: true },
        { name: '🧍 Survivors', value: String(survivors), inline: true },
        { name: '👥 Total Tracked', value: String(total), inline: true },
        { name: '❤️ Avg Health', value: String(avgHealth), inline: true },
        { name: '🥫 Avg Hunger', value: String(avgHunger), inline: true },
        { name: '🚨 Active Outbreak', value: activeOutbreak ? 'Yes' : 'No', inline: true },
        { name: '👑 Active Raid', value: activeRaid ? 'Yes' : 'No', inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
});

client.login(TOKEN);