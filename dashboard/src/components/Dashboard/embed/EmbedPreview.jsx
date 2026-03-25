import { Send } from 'lucide-react';
import { normalizeOptionalHttpUrl } from './urlValidation';

export default function EmbedPreview({ embedData }) {
  const titleUrlCheck = normalizeOptionalHttpUrl(embedData.titleUrl);
  const hasTitleLink = titleUrlCheck.ok && titleUrlCheck.value.length > 0;

  return (
    <div className="bg-[#16162a] p-6 rounded-[2rem] border border-white/5 shadow-2xl flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-4 mb-6">
        <div className="p-3 bg-purple-600/20 rounded-2xl text-purple-400">
          <Send size={24} />
        </div>
        <h2 className="text-xl font-black italic uppercase tracking-wider text-white">Canli Onizleme</h2>
      </div>

      <div className="flex-1 bg-[#313338] rounded-2xl p-6 border border-black/20 shadow-inner overflow-y-auto">
        <div className="flex gap-4 items-start">
          <div className="w-10 h-10 rounded-full bg-indigo-500 flex-shrink-0 flex items-center justify-center text-white font-bold text-xs shadow-lg mt-1">
            BOT
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-sm">Geass</span>
              <span className="bg-[#5865f2] text-[10px] text-white px-1.5 rounded-[4px] py-0.5 font-medium">BOT</span>
              <span className="text-gray-400 text-xs ml-1">Bugun saat 14:30</span>
            </div>

            {embedData.content && (
              <p className="text-gray-300 text-sm mt-1 mb-2 whitespace-pre-wrap break-words">{embedData.content}</p>
            )}

            <div
              className="bg-[#2b2d31] rounded-l-[4px] rounded-r-lg max-w-full mt-1 overflow-hidden shadow-sm grid"
              style={{ borderLeft: `4px solid ${embedData.color}` }}
            >
              <div className="p-4 space-y-2 grid">
                {embedData.title &&
                  (hasTitleLink ? (
                    <a
                      href={titleUrlCheck.value}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[#00A8FC] font-bold text-base break-words hover:underline"
                    >
                      {embedData.title}
                    </a>
                  ) : (
                    <h4 className="text-white font-bold text-base break-words">{embedData.title}</h4>
                  ))}
                {embedData.description && (
                  <p className="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed break-words">{embedData.description}</p>
                )}

                {embedData.image && (
                  <div className="mt-2 rounded-lg overflow-hidden border border-white/5">
                    <img src={embedData.image} alt="Embed Visual" className="w-full h-auto object-cover max-h-80" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

