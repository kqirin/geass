import { useNavigate } from 'react-router-dom';

import Moderation from '../components/Dashboard/Moderation';
import Messages from '../components/Dashboard/Messages';
import EmbedSender from '../components/Dashboard/EmbedSender';
import VC from '../components/Dashboard/VC';
import WeeklyStaff from '../components/Dashboard/WeeklyStaff';
import ReactionActions from '../components/Dashboard/ReactionActions';

import DashboardHeader from '../components/Dashboard/shell/DashboardHeader';
import SystemHealthCard from '../components/Dashboard/shell/SystemHealthCard';
import DashboardTabs from '../components/Dashboard/shell/DashboardTabs';
import DashboardToast from '../components/Dashboard/shell/DashboardToast';
import { useDashboardData } from '../hooks/useDashboardData';

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    showToast,
    activeTab,
    setActiveTab,
    toast,
    guilds,
    guildId,
    setGuildId,
    systemHealth,
    roles,
    channels,
    modSettings,
    setModSettings,
    weeklySettings,
    setWeeklySettings,
    weeklyLeaderboard,
    weeklyHistory,
    reactionRules,
    reactionHealth,
    emojis,
    reactionForm,
    setReactionForm,
    embedData,
    setEmbedData,
    canSelectGuild,
    saveSettings,
    saveWeeklySettings,
    runWeeklySelection,
    toggleWeeklyEnabled,
    loadWeeklyStaffData,
    loadReactionData,
    saveReactionRule,
    deleteReactionRule,
    toggleReactionRuleEnabled,
    editReactionRule,
    resetReactionForm,
    testReactionRule,
    sendEmbed,
    logout,
  } = useDashboardData({ navigate });

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b0b14] via-[#0b0b14] to-[#07070f] text-white">
      <div className="max-w-[1200px] mx-auto px-6 pt-10">
        <DashboardHeader
          guilds={guilds}
          guildId={guildId}
          canSelectGuild={canSelectGuild}
          onGuildChange={setGuildId}
          onLogout={logout}
        />

        <SystemHealthCard health={systemHealth} />

        <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />

        <div className="mt-10">
          {activeTab === 'moderation' && (
            <Moderation
              roles={roles}
              modSettings={modSettings}
              setModSettings={setModSettings}
              handleSave={saveSettings}
              guildId={guildId}
              showToast={showToast}
            />
          )}

          {activeTab === 'messages' && (
            <Messages guildId={guildId} showToast={showToast} />
          )}

          {activeTab === 'embed' && (
            <EmbedSender
              embedData={embedData}
              setEmbedData={setEmbedData}
              channels={channels}
              handleSendEmbed={sendEmbed}
            />
          )}

          {activeTab === 'vc' && <VC guildId={guildId} roles={roles} />}

          {activeTab === 'weeklyStaff' && (
            <WeeklyStaff
              roles={roles}
              channels={channels}
              weeklySettings={weeklySettings}
              setWeeklySettings={setWeeklySettings}
              leaderboard={weeklyLeaderboard}
              history={weeklyHistory}
              onSave={saveWeeklySettings}
              onRefresh={() => loadWeeklyStaffData(guildId)}
              onManualRun={runWeeklySelection}
              onToggleEnabled={toggleWeeklyEnabled}
            />
          )}

          {activeTab === 'reactionActions' && (
            <ReactionActions
              guildId={guildId}
              roles={roles}
              channels={channels}
              emojis={emojis}
              reactionRules={reactionRules}
              reactionHealth={reactionHealth}
              reactionForm={reactionForm}
              setReactionForm={setReactionForm}
              onSave={saveReactionRule}
              onDelete={deleteReactionRule}
              onToggleEnabled={toggleReactionRuleEnabled}
              onEdit={editReactionRule}
              onReset={resetReactionForm}
              onReload={() => loadReactionData(guildId)}
              onTest={testReactionRule}
            />
          )}
        </div>
      </div>

      <DashboardToast toast={toast} />
    </div>
  );
}

