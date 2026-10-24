"""Checks event correlation without making HTTP requests or generating writes."""
import importlib.util, json, pathlib, tempfile, unittest
spec=importlib.util.spec_from_file_location('matrix',pathlib.Path(__file__).with_name('matrix.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PropagationTest(unittest.TestCase):
    def measure(self, events):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'events.log'
            p.write_text('noise\n'+'\n'.join('FIELD_EVENT '+json.dumps(e) for e in events))
            return m.propagation(p)
    def test_snapshot_inicial_pode_conter_escrita_confirmada(self):
        result=self.measure([{'event':'ack','sequence':0,'house':1,'status':True,'started':10,'at':20,'owner':0},{'event':'initial','at':25,'observer':1,'states':[[1,True]]}])
        self.assertEqual(result['latencies_ms'],[5]);self.assertEqual(result['missing_sequences'],[])
    def test_reutilizacao_da_casa_nao_aproveita_observacao_antiga(self):
        events=[{'event':'ack','sequence':i,'house':1,'status':True,'started':t,'at':t+2,'owner':0} for i,t in enumerate([10,100])]
        events.append({'event':'seen','house':1,'status':True,'at':30,'observer':1})
        result=self.measure(events)
        self.assertEqual(result['latencies_ms'],[18]);self.assertEqual(result['missing_sequences'],[1])
    def test_nao_considera_a_propria_tela_do_escritor(self):
        result=self.measure([{'event':'ack','sequence':0,'house':1,'status':True,'started':10,'at':20,'owner':0},{'event':'seen','house':1,'status':True,'at':25,'observer':0}])
        self.assertEqual(result['samples'],0);self.assertEqual(result['missing_sequences'],[0])
    def test_observacao_apos_commit_e_antes_do_ack_tem_atraso_zero(self):
        result=self.measure([{'event':'ack','sequence':0,'house':1,'status':True,'started':10,'at':20,'owner':0},{'event':'seen','house':1,'status':True,'at':15,'observer':1}])
        self.assertEqual(result['latencies_ms'],[0])
if __name__=='__main__':unittest.main()
