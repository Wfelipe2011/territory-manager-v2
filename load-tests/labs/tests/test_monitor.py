import sys, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import compare

class MonitorTests(unittest.TestCase):
    def test_recupera_coleta_apos_falha_http_sem_ocultar_o_erro(self):
        stop=MagicMock();stop.is_set.side_effect=[False,False,True]
        health=MagicMock();health.__enter__.return_value.read.return_value=b'{"stats":{}}'
        samples=[]
        with patch.object(compare.subprocess,'check_output',return_value='territory-field-labs-bun-1'), patch.object(compare.subprocess,'run',return_value=SimpleNamespace(stdout='{"Name":"territory-field-labs-bun-1","CPUPerc":"10%"}')), patch.object(compare.urllib.request,'urlopen',side_effect=[OSError('synthetic outage'),health]), patch.object(compare.lab,'compose',return_value=SimpleNamespace(stdout='usage_usec 1')), patch.object(compare,'db',return_value='{}'):
            compare.monitor(stop,samples,'generator')
        self.assertEqual(samples[0]['error'],'OSError')
        self.assertEqual(samples[1]['containers'][0]['Name'],'territory-field-labs-bun-1')
        self.assertEqual(stop.wait.call_count,2)

if __name__=='__main__':unittest.main()
