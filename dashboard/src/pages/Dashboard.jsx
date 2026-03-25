import { useNavigate } from 'react-router-dom';

import Moderation from '../components/Dashboard/Moderation';
import EmbedSender from '../components/Dashboard/EmbedSender';
import ReactionActions from '../components/Dashboard/ReactionActions';

import DashboardHeader from '../components/Dashboard/shell/DashboardHeader';
import SystemHealthCard from '../components/Dashboard/shell/SystemHealthCard';
import DashboardTabs from '../components/Dashboard/shell/DashboardTabs';
import DashboardToast from '../components/Dashboard/shell/DashboardToast';
import { useDashboardData } from '../hooks/useDashboardData';

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    activeTab,
    setActiveTab,
    toast,
    guilds,
    guildId,
    setGuildId,
    activeGuildName,
    singleGuildMode,
    systemHealth,
    roles,
    channels,
    modSettings,
    settingsMeta,
    botPresenceSettings,
    botPresenceMeta,
    botPresenceLoadState,
    reactionRules,
    reactionHealth,
    emojis,
    reactionForm,
    setReactionForm,
    embedData,
    setEmbedData,
    canSelectGuild,
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
          activeGuildName={activeGuildName}
          singleGuildMode={singleGuildMode}
          canSelectGuild={canSelectGuild}
          onGuildChange={setGuildId}
          onLogout={logout}
        />

        <SystemHealthCard health={systemHealth} />

        <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />

        <div className="mt-10">
          {activeTab === 'policy' && (
            <Moderation
              roles={roles}
              modSettings={modSettings}
              settingsMeta={settingsMeta}
              botPresenceSettings={botPresenceSettings}
              botPresenceMeta={botPresenceMeta}
              botPresenceLoadState={botPresenceLoadState}
            />
          )}

          {activeTab === 'embed' && (
            <EmbedSender
              embedData={embedData}
              setEmbedData={setEmbedData}
              channels={channels}
              handleSendEmbed={sendEmbed}
            />
          )}
          {activeTab === 'reactionActions' && (
            <ReactionActions
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

