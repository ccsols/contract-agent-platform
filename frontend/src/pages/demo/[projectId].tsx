import React, { useState, useEffect, useCallback } from 'react';

interface Party {
  address: string;
  role: string;
  name?: string;
}

interface Term {
  id: string;
  type: string;
  description: string;
  eligible: string;
  details: { reason: string };
  priority: string;
}

interface Transaction {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
  status: 'pending' | 'success' | 'failed';
}

interface ContractState {
  status: string;
  parties: Party[];
  terms: Term[];
  transactions: Transaction[];
  metadata: {
    project_id: string;
    project_name: string;
    template: string;
  };
}

const CONTRACT_ABI = {
  methods: [
    { name: 'initialize', inputs: [{ name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'monthly_rent', type: 'uint256' }, { name: 'deposit', type: 'uint256' }, { name: 'start_date', type: 'uint256' }, { name: 'end_date', type: 'uint256' }, { name: 'payment_day', type: 'uint8' }], outputs: [] },
    { name: 'sign', inputs: [{ name: 'party', type: 'address' }], outputs: [{ name: 'success', type: 'bool' }] },
    { name: 'payRent', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'success', type: 'bool' }] },
    { name: 'terminate', inputs: [{ name: 'party', type: 'address' }, { name: 'reason', type: 'string' }], outputs: [{ name: 'success', type: 'bool' }] },
    { name: 'getStatus', inputs: [], outputs: [{ name: 'status', type: 'string' }] },
  ]
};

// 跨上下文复制工具（兼容 HTTP + HTTPS）
function copyToClipboard(text: string): void {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (e) {}
}

export default function ContractDemoPage() {
  const [contractState, setContractState] = useState<ContractState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [formParams, setFormParams] = useState({
    landlord: '',
    tenant: '',
    monthly_rent: '',
    deposit: '',
    start_date: '',
    end_date: '',
    payment_day: '1',
  });
  const [showInitForm, setShowInitForm] = useState(false);

  const projectId = typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : '';
  const backendUrl = 'http://122.51.247.121:5000';
  const simulatorUrl = 'http://122.51.247.121:5000';

  const fetchContractState = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${simulatorUrl}/api/simulate/${projectId}`);
      if (!response.ok) throw new Error('Failed to fetch contract state');
      const data = await response.json();
      setContractState(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setContractState({
        status: 'NOT_ELIGIBLE',
        parties: [],
        terms: [
          { id: 'T001', type: 'general', description: '租赁双方信息缺失', eligible: 'TermEligibility.NOT_ELIGIBLE', details: { reason: 'parties对象为空，缺少 landlord 和 tenant 信息' }, priority: 'high' },
          { id: 'T002', type: 'payment', description: '租金金额未指定', eligible: 'TermEligibility.NOT_ELIGIBLE', details: { reason: '缺少 monthly_rent 字段' }, priority: 'high' },
          { id: 'T003', type: 'deposit', description: '押金信息未指定', eligible: 'TermEligibility.NOT_ELIGIBLE', details: { reason: '缺少 deposit 字段' }, priority: 'medium' },
          { id: 'T004', type: 'time', description: '租赁期限未指定', eligible: 'TermEligibility.NOT_ELIGIBLE', details: { reason: '缺少 start_date、end_date、payment_day 字段' }, priority: 'high' },
        ],
        transactions: [],
        metadata: { project_id: projectId, project_name: projectId, template: 'housing_lease' },
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, simulatorUrl]);

  useEffect(() => {
    fetchContractState();
    const interval = setInterval(fetchContractState, 10000);
    return () => clearInterval(interval);
  }, [fetchContractState]);

  const handleAction = async (action: string, params?: Record<string, unknown>) => {
    setActionLoading(action);
    try {
      const response = await fetch(`${backendUrl}/api/contracts/${projectId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params }),
      });
      if (!response.ok) throw new Error(`Action ${action} failed`);
      await fetchContractState();
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleInitialize = async () => {
    setActionLoading('initialize');
    try {
      const params = {
        landlord: formParams.landlord || '0x0000000000000000000000000000000000000001',
        tenant: formParams.tenant || '0x0000000000000000000000000000000000000002',
        monthly_rent: BigInt(formParams.monthly_rent || '5000000000000000000'),
        deposit: BigInt(formParams.deposit || '10000000000000000000'),
        start_date: BigInt(formParams.start_date || Math.floor(Date.now() / 1000)),
        end_date: BigInt(formParams.end_date || Math.floor(Date.now() / 1000) + 31536000),
        payment_day: parseInt(formParams.payment_day || '1'),
      };
      const response = await fetch(`${backendUrl}/api/contracts/${projectId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'initialize', params }),
      });
      if (!response.ok) throw new Error('Initialize failed');
      setShowInitForm(false);
      await fetchContractState();
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusColor = (status: string) => {
    if (status.includes('NOT_ELIGIBLE')) return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (status.includes('PENDING')) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    if (status.includes('ACTIVE')) return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (status.includes('TERMINATED')) return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  };

  const getPriorityColor = (priority: string) => {
    if (priority === 'high') return 'text-red-400';
    if (priority === 'medium') return 'text-yellow-400';
    return 'text-gray-400';
  };

  const formatTimestamp = (ts: string) => {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  };

  if (loading && !contractState) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">加载合约状态中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{contractState?.metadata.project_name || projectId}</h1>
            <p className="text-sm text-gray-400 mt-1">合约ID: {projectId}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className={`px-3 py-1 rounded-full text-sm border ${getStatusColor(contractState?.status || 'UNKNOWN')}`}>
              {contractState?.status || 'UNKNOWN'}
            </span>
            <button
              onClick={() => copyToClipboard(window.location.href)}
              className="px-3 py-1 text-sm bg-gray-800 hover:bg-gray-700 rounded border border-gray-700"
            >
              复制链接
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
            <p className="font-medium">错误</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <section className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                合约条款状态
              </h2>
              <div className="space-y-3">
                {contractState?.terms.map((term) => (
                  <div key={term.id} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-gray-500">{term.id}</span>
                          <span className={`text-xs ${getPriorityColor(term.priority)}`}>[{term.priority}]</span>
                          <span className="px-2 py-0.5 text-xs rounded bg-gray-700">{term.type}</span>
                        </div>
                        <p className="mt-1 font-medium">{term.description}</p>
                        <p className="text-sm text-gray-400 mt-1">{term.details.reason}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ${term.eligible.includes('NOT_ELIGIBLE') ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                        {term.eligible.split('.').pop()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                交易历史
              </h2>
              {contractState?.transactions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>暂无交易记录</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {contractState?.transactions.map((tx) => (
                    <div key={tx.id} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`w-2 h-2 rounded-full ${tx.status === 'success' ? 'bg-green-500' : tx.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
                        <span className="font-mono text-sm">{tx.type}</span>
                      </div>
                      <span className="text-xs text-gray-500">{formatTimestamp(tx.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="space-y-6">
            <section className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                参与方信息
              </h2>
              {contractState?.parties.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  <p>暂无参与方信息</p>
                  <p className="text-xs mt-1">请先初始化合约</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {contractState?.parties.map((party, idx) => (
                    <div key={idx} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                      <div className="text-xs text-gray-500 mb-1">{party.role}</div>
                      <div className="font-mono text-sm truncate">{party.address}</div>
                      {party.name && <div className="text-sm text-gray-400 mt-1">{party.name}</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                合约操作
              </h2>
              <div className="space-y-3">
                {!showInitForm ? (
                  <>
                    <button
                      onClick={() => setShowInitForm(true)}
                      disabled={actionLoading !== null}
                      className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                    >
                      {actionLoading === 'initialize' ? '初始化中...' : '初始化合约'}
                    </button>
                    <button
                      onClick={() => handleAction('sign', { party: formParams.landlord || '0x0000000000000000000000000000000000000001' })}
                      disabled={actionLoading !== null || contractState?.status.includes('NOT_ELIGIBLE')}
                      className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                    >
                      {actionLoading === 'sign' ? '签署中...' : '房东签署'}
                    </button>
                    <button
                      onClick={() => handleAction('sign', { party: formParams.tenant || '0x0000000000000000000000000000000000000002' })}
                      disabled={actionLoading !== null || contractState?.status.includes('NOT_ELIGIBLE')}
                      className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                    >
                      {actionLoading === 'sign' ? '签署中...' : '租客签署'}
                    </button>
                    <button
                      onClick={() => handleAction('payRent', { amount: '5000000000000000000' })}
                      disabled={actionLoading !== null || !contractState?.status.includes('ACTIVE')}
                      className="w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                    >
                      {actionLoading === 'payRent' ? '支付中...' : '支付租金'}
                    </button>
                    <button
                      onClick={() => handleAction('terminate', { party: '0x0000000000000000000000000000000000000001', reason: '合同终止' })}
                      disabled={actionLoading !== null || contractState?.status.includes('NOT_ELIGIBLE')}
                      className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                    >
                      {actionLoading === 'terminate' ? '终止中...' : '终止合约'}
                    </button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">房东地址</label>
                      <input
                        type="text"
                        value={formParams.landlord}
                        onChange={(e) => setFormParams({ ...formParams, landlord: e.target.value })}
                        placeholder="0x..."
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">租客地址</label>
                      <input
                        type="text"
                        value={formParams.tenant}
                        onChange={(e) => setFormParams({ ...formParams, tenant: e.target.value })}
                        placeholder="0x..."
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">月租金 (ETH)</label>
                      <input
                        type="text"
                        value={formParams.monthly_rent}
                        onChange={(e) => setFormParams({ ...formParams, monthly_rent: e.target.value })}
                        placeholder="5.0"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">押金 (ETH)</label>
                      <input
                        type="text"
                        value={formParams.deposit}
                        onChange={(e) => setFormParams({ ...formParams, deposit: e.target.value })}
                        placeholder="10.0"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleInitialize}
                        disabled={actionLoading === 'initialize'}
                        className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-lg font-medium transition-colors"
                      >
                        {actionLoading === 'initialize' ? '初始化中...' : '确认'}
                      </button>
                      <button
                        onClick={() => setShowInitForm(false)}
                        className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-cyan-500 rounded-full"></span>
                合约 ABI
              </h2>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {CONTRACT_ABI.methods.map((method) => (
                  <details key={method.name} className="bg-gray-800/50 rounded-lg border border-gray-700/50">
                    <summary className="px-3 py-2 cursor-pointer text-sm font-mono hover:bg-gray-800">
                      {method.name}()
                    </summary>
                    <div className="px-3 py-2 text-xs text-gray-400 border-t border-gray-700/50">
                      <p className="font-medium text-gray-300 mb-1">Inputs:</p>
                      {method.inputs.map((input, idx) => (
                        <div key={idx} className="font-mono">{input.name}: {input.type}</div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-800 px-6 py-4 mt-8">
        <div className="max-w-6xl mx-auto text-center text-sm text-gray-500">
          <p>合约模拟器: {simulatorUrl}</p>
          <p className="mt-1">后端 API: {backendUrl}</p>
        </div>
      </footer>
    </div>
  );
}