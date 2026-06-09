const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json()); 

// Sua conexão com o Neon
const pool = new Pool({
  host: 'ep-broad-shadow-acax91qy.sa-east-1.aws.neon.tech',
  database: 'neondb',
  user: 'neondb_owner',
  password: 'npg_Aab6x8vmEZKn', // Sua senha
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

// NOVA ROTA: Validação de Login
app.post('/api/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    const query = `
      SELECT usu_codigo, usu_nome 
      FROM seg_usuario 
      WHERE usu_login = $1 AND usu_senha = $2 AND usu_ativo = 'S'
    `;
    
    const resultado = await pool.query(query, [usuario, senha]);

    // Se encontrou 1 registro, a senha está correta
    if (resultado.rowCount > 0) {
      res.status(200).json({ 
        sucesso: true, 
        mensagem: 'Login aprovado',
        nome: resultado.rows[0].usu_nome 
      });
    } else {
      res.status(401).json({ 
        sucesso: false, 
        mensagem: 'Usuário ou senha incorretos' 
      });
    }
  } catch (erro) {
    console.error('Erro no login:', erro);
    res.status(500).json({ sucesso: false, mensagem: 'Erro interno no servidor' });
  }
});

// Rota para buscar o Plano de Contas da empresa
app.get('/api/contas/:empresa', async (req, res) => {
  try {
    const empresaId = req.params.empresa;
    
    // Supondo que a chave primária seja pla_codigo. Adapte se for outro nome.
    const query = `
      SELECT pla_contareduzida, pla_descricao 
      FROM con_plano_contas 
      WHERE pla_empresa = $1 
      ORDER BY pla_conta
    `;
    
    const resultado = await pool.query(query, [empresaId]);
    res.status(200).json(resultado.rows);
    
  } catch (erro) {
    console.error('Erro ao buscar contas:', erro);
    res.status(500).json({ mensagem: 'Erro ao buscar plano de contas no banco.' });
  }
});

// Rota para o Relatório de Balancete Mensal (Com Saldo Anterior e Movimento)
app.get('/api/balancete/:empresa', async (req, res) => {
  try {
    const empresaId = req.params.empresa;
    const mes = req.query.mes || '01';
    const ano = req.query.ano || '2026';
    
    // Monta o formato YYYY-MM-01 (O primeiro dia do mês escolhido)
    const mesFormatado = mes.toString().padStart(2, '0');
    const dataInicio = `${ano}-${mesFormatado}-01`;
    
    const query = `
      SELECT 
        p.pla_contareduzida, 
        p.pla_conta, 
        p.pla_descricao,
        
        -- 1. SALDO ANTERIOR (Tudo que aconteceu ANTES do dia 1º do mês selecionado)
        COALESCE((SELECT SUM(lan_valor) FROM con_lancamento WHERE lan_contadebito = p.pla_contareduzida AND lan_empresa = $1 AND lan_data < $2::date), 0) -
        COALESCE((SELECT SUM(lan_valor) FROM con_lancamento WHERE lan_contacredito = p.pla_contareduzida AND lan_empresa = $1 AND lan_data < $2::date), 0) AS saldo_anterior,
        
        -- 2. MOVIMENTO DO MÊS (Tudo que aconteceu DENTRO do mês selecionado)
        COALESCE((SELECT SUM(lan_valor) FROM con_lancamento WHERE lan_contadebito = p.pla_contareduzida AND lan_empresa = $1 AND lan_data >= $2::date AND lan_data < ($2::date + interval '1 month')), 0) -
        COALESCE((SELECT SUM(lan_valor) FROM con_lancamento WHERE lan_contacredito = p.pla_contareduzida AND lan_empresa = $1 AND lan_data >= $2::date AND lan_data < ($2::date + interval '1 month')), 0) AS movimento_mes

      FROM con_plano_contas p
      WHERE p.pla_empresa = $1 
      ORDER BY p.pla_conta
    `;
    
    // Passamos a empresa ($1) e a data inicial ($2) para o SQL
    const resultado = await pool.query(query, [empresaId, dataInicio]);
    res.status(200).json(resultado.rows);
    
  } catch (erro) {
    console.error('Erro ao buscar balancete:', erro);
    res.status(500).json({ mensagem: 'Erro ao gerar dados do relatório.' });
  }
});

// Rota para o Relatório de DRE Comparativo (12 Meses)
app.get('/api/dre/:empresa/:ano', async (req, res) => {
  try {
    const empresaId = req.params.empresa;
    const ano = req.params.ano;
    
    // O SQL extrai o mês de cada lançamento e cria 12 colunas virtuais.
    // Para DRE, a lógica é CRÉDITO (Receita) - DÉBITO (Despesa)
    const query = `
      SELECT 
        p.pla_contareduzida, p.pla_conta, p.pla_descricao,
        ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `
          COALESCE(SUM(CASE WHEN l.lan_contacredito = p.pla_contareduzida AND EXTRACT(MONTH FROM l.lan_data) = ${m} THEN l.lan_valor ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN l.lan_contadebito = p.pla_contareduzida AND EXTRACT(MONTH FROM l.lan_data) = ${m} THEN l.lan_valor ELSE 0 END), 0) AS m${m}
        `).join(', ')}
      FROM con_plano_contas p
      LEFT JOIN con_lancamento l ON (l.lan_contadebito = p.pla_contareduzida OR l.lan_contacredito = p.pla_contareduzida) 
                                 AND l.lan_empresa = $1 AND EXTRACT(YEAR FROM l.lan_data) = $2
      WHERE p.pla_empresa = $1 AND p.pla_conta::text LIKE '3%'
      GROUP BY p.pla_contareduzida, p.pla_conta, p.pla_descricao
      ORDER BY p.pla_conta
    `;
    
    const resultado = await pool.query(query, [empresaId, ano]);
    res.status(200).json(resultado.rows);
    
  } catch (erro) {
    console.error('Erro ao buscar DRE:', erro);
    res.status(500).json({ mensagem: 'Erro ao gerar dados do DRE.' });
  }
});

// Rota para Consulta de Extrato em Tela (Razão Contábil)
app.get('/api/extrato/:empresa', async (req, res) => {
  try {
    const empresaId = req.params.empresa;
    const { conta, dataInicio, dataFim } = req.query;

    // 1. Busca o Saldo Anterior (Tudo que aconteceu ANTES da data inicial)
    // Se a conta for Débito ela soma, se for Crédito ela subtrai.
    const querySaldo = `
      SELECT 
        COALESCE(SUM(CASE WHEN lan_contadebito = $2 THEN lan_valor ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN lan_contacredito = $2 THEN lan_valor ELSE 0 END), 0) AS saldo_anterior
      FROM con_lancamento
      WHERE lan_empresa = $1 AND lan_data < $3 AND (lan_contadebito = $2 OR lan_contacredito = $2)
    `;
    const resSaldo = await pool.query(querySaldo, [empresaId, conta, dataInicio]);
    const saldoAnterior = resSaldo.rows[0]?.saldo_anterior || 0;

    // 2. Busca o histórico de movimentações dentro do período
    const queryMov = `
      SELECT 
        lan_codigo,
        lan_data,
        lan_historico,
        CASE WHEN lan_contadebito = $2 THEN lan_contacredito ELSE lan_contadebito END as contra_partida,
        CASE WHEN lan_contadebito = $2 THEN lan_valor ELSE (lan_valor * -1) END as valor
      FROM con_lancamento
      WHERE lan_empresa = $1 
        AND lan_data >= $3 
        AND lan_data <= $4
        AND (lan_contadebito = $2 OR lan_contacredito = $2)
      ORDER BY lan_data ASC, lan_codigo ASC
    `;
    const resMov = await pool.query(queryMov, [empresaId, conta, dataInicio, dataFim]);

    res.status(200).json({
      saldo_anterior: parseFloat(saldoAnterior),
      movimentos: resMov.rows
    });

  } catch (erro) {
    console.error('Erro ao buscar extrato:', erro);
    res.status(500).json({ mensagem: 'Erro ao gerar extrato no banco.' });
  }
});

// Rota de Gravação de Despesas (Mantida igual)
app.post('/api/despesas', async (req, res) => {
  try {
    const { empresa, data, conta_debito, conta_credito, valor, historico } = req.body;

    const query = `
      INSERT INTO con_lancamento 
      (lan_empresa, lan_data, lan_contadebito, lan_contacredito, lan_valor, lan_historico)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING lan_codigo;
    `;
    
    const resultado = await pool.query(query, [empresa, data, conta_debito, conta_credito, valor, historico]);
    res.status(201).json({ mensagem: 'Salvo com sucesso!', id: resultado.rows[0].lan_codigo });
    
  } catch (erro) {
    console.error('Erro ao inserir:', erro);
    res.status(500).json({ mensagem: 'Erro ao salvar no banco.' });
  }
});

// ==========================================
// Rota para Buscar Lançamentos (Para Edição com Filtros)
// ==========================================
app.get('/api/lancamentos/:empresa', async (req, res) => {
  try {
    const empresaId = req.params.empresa;
    const { texto, conta, dataInicio, dataFim } = req.query;

    let query = `
      SELECT lan_codigo, TO_CHAR(lan_data, 'YYYY-MM-DD') as lan_data, lan_contadebito, lan_contacredito, lan_valor, lan_historico
      FROM con_lancamento
      WHERE lan_empresa = $1
    `;
    const params = [empresaId];
    let paramCount = 2;

    // Filtro de Data
    if (dataInicio && dataFim) {
        query += ` AND lan_data >= $${paramCount} AND lan_data <= $${paramCount+1}`;
        params.push(dataInicio, dataFim);
        paramCount += 2;
    }

    // Filtro de Conta (Procura tanto no débito quanto no crédito)
    if (conta) {
        query += ` AND (lan_contadebito = $${paramCount} OR lan_contacredito = $${paramCount})`;
        params.push(conta);
        paramCount++;
    }

    // Filtro de Texto (Procura no Histórico, no Valor e no ID)
    if (texto) {
        query += ` AND (lan_historico ILIKE $${paramCount} OR lan_codigo::text = $${paramCount} OR lan_valor::text LIKE $${paramCount})`;
        params.push(`%${texto}%`);
        paramCount++;
    }

  query += ` ORDER BY lan_data ASC, lan_codigo ASC LIMIT 100`;

    const resultado = await pool.query(query, params);
    res.status(200).json(resultado.rows);
  } catch (erro) {
    console.error('Erro ao buscar lançamentos:', erro);
    res.status(500).json({ mensagem: 'Erro ao buscar lançamentos.' });
  }
});

// ==========================================
// Rota para Atualizar Lançamento Existente
// ==========================================
app.put('/api/despesas/:id', async (req, res) => {
  try {
    const lan_codigo = req.params.id;
    const { empresa, data, conta_debito, conta_credito, valor, historico } = req.body;

    const query = `
      UPDATE con_lancamento
      SET lan_data = $1, lan_contadebito = $2, lan_contacredito = $3, lan_valor = $4, lan_historico = $5
      WHERE lan_codigo = $6 AND lan_empresa = $7
    `;
    await pool.query(query, [data, conta_debito, conta_credito, valor, historico, lan_codigo, empresa]);
    res.status(200).json({ mensagem: 'Atualizado com sucesso!' });
  } catch (erro) {
    console.error('Erro ao atualizar despesa:', erro);
    res.status(500).json({ mensagem: 'Erro ao atualizar no banco.' });
  }
});

// ==========================================
// Rota para Excluir Lançamento Existente
// ==========================================
app.delete('/api/despesas/:id/:empresa', async (req, res) => {
  try {
    const lan_codigo = req.params.id;
    const empresa = req.params.empresa; // Trava de segurança para garantir que é da empresa certa

    const query = `DELETE FROM con_lancamento WHERE lan_codigo = $1 AND lan_empresa = $2`;
    await pool.query(query, [lan_codigo, empresa]);

    res.status(200).json({ mensagem: 'Lançamento excluído com sucesso!' });
  } catch (erro) {
    console.error('Erro ao excluir despesa:', erro);
    res.status(500).json({ mensagem: 'Erro ao excluir no banco.' });
  }
});

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
  console.log(`API rodando na porta http://localhost:${PORTA}`);
});
