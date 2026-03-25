export function createLatestRequestGate(initialKey = '') {
  let activeKey = String(initialKey || '');
  let activeToken = 0;

  return {
    switchKey(nextKey) {
      activeKey = String(nextKey || '');
      activeToken += 1;
      return activeToken;
    },
    begin(nextKey = activeKey) {
      activeKey = String(nextKey || '');
      activeToken += 1;
      const token = activeToken;
      return {
        token,
        key: activeKey,
        isCurrent() {
          return token === activeToken && activeKey === String(nextKey || '');
        },
      };
    },
    isCurrent(token, key = activeKey) {
      return token === activeToken && activeKey === String(key || '');
    },
    getActiveKey() {
      return activeKey;
    },
  };
}
