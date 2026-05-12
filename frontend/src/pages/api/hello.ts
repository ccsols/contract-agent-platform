import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ 
    status: 'ok', 
    message: 'AI Contract Platform API',
    endpoints: [
      'POST /api/generate - 启动生成流程',
      'GET /api/project/:id - 获取项目状态',
      'GET /api/templates - 获取模板列表'
    ]
  });
}
