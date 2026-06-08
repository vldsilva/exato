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

// Rota para o Relatório de Balancete com Cálculo de Lançamentos
app.get('/api/balancete/:empresa', async (req, res) => {
  try {
    const empresaId = req.params.empresa;
    
    // O SQL agora vai na tabela con_lancamento e soma todos os débitos e créditos de cada conta
    const query = `
      SELECT 
        p.pla_contareduzida, 
        p.pla_conta, 
        p.pla_descricao,
        COALESCE((SELECT SUM(lan_valor) FROM con_lancamento WHERE lan_contadebito = p.pla_contareduzida AND lan_empresa = $1), 0) AS total_debito,
        COALESCE((SELECT SUM(lan_valor) FROM con_lancamento WHERE lan_contacredito = p.pla_contareduzida AND lan_empresa = $1), 0) AS total_credito
      FROM con_plano_contas p
      WHERE p.pla_empresa = $1 
      ORDER BY p.pla_conta
    `;
    
    const resultado = await pool.query(query, [empresaId]);
    res.status(200).json(resultado.rows);
    
  } catch (erro) {
    console.error('Erro ao buscar balancete:', erro);
    res.status(500).json({ mensagem: 'Erro ao gerar dados do relatório.' });
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

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
  console.log(`API rodando na porta http://localhost:${PORTA}`);
});
