import EmbedForm from './embed/EmbedForm';
import EmbedPreview from './embed/EmbedPreview';

export default function EmbedSender({ embedData, setEmbedData, channels, handleSendEmbed }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-6rem)]">
      <EmbedForm embedData={embedData} setEmbedData={setEmbedData} channels={channels} onSend={handleSendEmbed} />
      <EmbedPreview embedData={embedData} />
    </div>
  );
}

