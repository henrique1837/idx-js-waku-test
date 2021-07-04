import React from 'react';
import {
  ChakraProvider,
  Box,
  Text,
  Button,
  VStack,
  Code,
  Grid,
  Input,
  Tabs,
  Tab,
  TabList,
  TabPanels,
  TabPanel,
  theme,
} from '@chakra-ui/react';
import { ColorModeSwitcher } from './ColorModeSwitcher';
import { Logo } from './Logo';
import Web3 from 'web3';
import Web3Modal from "web3modal";
import {
  ChatMessage,
  Direction,
  Environment,
  getStatusFleetNodes,
  Protocol,
  StoreCodec,
  Waku,
  WakuMessage,
} from 'js-waku';

//import WakuPubKeyStore from './contracts/WakuPubKeyStore.json';

import { EthereumAuthProvider, ThreeIdConnect } from '@3id/connect'
import ThreeIdResolver from '@ceramicnetwork/3id-did-resolver'
import Ceramic from '@ceramicnetwork/http-client'
import { IDX } from '@ceramicstudio/idx'
import { DID } from 'dids'


const CERAMIC_URL = process.env.CERAMIC_API || 'https://ceramic-clay.3boxlabs.com'

const threeIdConnect = new ThreeIdConnect()


const providerOptions = {
  injected: {
    package: null
  }
};
const web3Modal = new Web3Modal({
  cacheProvider: true, // optional
  providerOptions // required
});

class App extends React.Component {
  state = {
    name: "/test-0x1234/proto",
    messages: [],
    decmessages: []
  }

  constructor(props){
    super(props)
    this.connectWeb3 = this.connectWeb3.bind(this);
    this.post = this.post.bind(this);
    this.decrypt = this.decrypt.bind(this);
  }

  componentDidMount = async () => {

    if (web3Modal.cachedProvider) {
      await this.connectWeb3();
    }
  }

  connectWeb3 = async () => {
    this.setState({
      loading: true
    });
    try{
      const provider =  await web3Modal.connect();;
      const web3 = new Web3(provider);
      const coinbase = await web3.eth.getCoinbase();
      const netId = await web3.eth.net.getId();
      /*
      const contract =  new web3.eth.Contract(WakuPubKeyStore.abi,"0xA96409BaF6875987bC753C9a95bD526F5b10a866");
      const pubKey = await provider.request({
        method: 'eth_getEncryptionPublicKey',
        params: [coinbase], // you must have access to the specified account
      });
      */
      this.setState({
        web3: web3,
        coinbase:coinbase,
        netId:netId,
        provider: provider,
        //contract: contract,
        //pubKey: pubKey
      });

      provider.on('accountsChanged', accounts => window.location.reload(true));
      provider.on('chainChanged', chainId => window.location.reload(true));
      // Subscribe to provider disconnection
      provider.on("disconnect", async (error: { code: number; message: string }) => {
        await web3Modal.clearCachedProvider();
        window.location.reload(true);
      });
      await this.initIdx();
      await this.startWaku();
      this.setState({
        loading: false,
      })
    } catch(err){
      web3Modal.clearCachedProvider();
      this.setState({
        loading: false
      });
    }

  }

  initIdx = async () => {
    const authProvider = new EthereumAuthProvider(this.state.provider, this.state.coinbase)

    await threeIdConnect.connect(authProvider)

    const ceramic = new Ceramic(CERAMIC_URL)

    const did = new DID({
      provider: threeIdConnect.getDidProvider(),
      resolver: ThreeIdResolver.getResolver(ceramic)
    })

    await did.authenticate()
    console.log(did.id)

    const jws = await did.createJWS({ hello: 'world' })
    console.log(jws)
    this.setState({
      did: did
    });
  }

  startWaku = async () => {
    const waku = await Waku.create({
        libp2p: {
          config: {
            pubsub: {
              enabled: true,
              emitSelf: true,
            },
          },
        },
    });
    const nodes = await getStatusFleetNodes();
    await Promise.all(
      nodes.map((addr) => {
        return waku.dial(addr);
      })
    );
    this.setState({
      waku: waku
    })
    waku.relay.addObserver(async (msg) => {
      try{
        console.log("Message received:", msg.payloadAsUtf8)
        this.state.messages.unshift(msg)
        await this.forceUpdate();
        const decrypted = await this.decrypt(JSON.parse(msg.payloadAsUtf8).message);
        this.state.decmessages.unshift(decrypted);
        console.log(this.state.decmessages)
        await this.forceUpdate();
      } catch(err){
        console.log(err)
      }
    }, [this.state.name]);

    waku.libp2p.peerStore.once(
      'change:protocols',
      async ({ peerId, protocols }) => {
        if (protocols.includes(StoreCodec)) {
          console.log(
            `Retrieving archived messages from ${peerId.toB58String()}`
          );
          const messages = await waku.store.queryHistory({
            peerId,
            contentTopics: [this.state.name]
          });
          messages?.map(async (msg) => {
            try{
              this.state.messages.unshift(msg);
              await this.forceUpdate();
              const decrypted = await this.decrypt(JSON.parse(msg.payloadAsUtf8).message);
              this.state.decmessages.unshift(decrypted);
              console.log(this.state.decmessages)
              await this.forceUpdate();
            } catch(err){
              console.log(err)
            }
          });
        }
      }
    );
  }



  getPubKey = async () => {
    const contract = this.state.contract;
    const address = this.state.address;
    const pubKey = this.state.pubKey;
    this.setState({
      to: pubKey
    })
  }

  decrypt = async (jwe) => {
    return(await this.state.did.decryptDagJWE(jwe));
  }

  post = async () => {
    try{
      let jwe;
      if(this.state.toDid){
        jwe = await this.state.did.createDagJWE(this.state.message, [this.state.did.id,this.state.toDid]) //  can add others did
      } else {
        jwe = await this.state.did.createDagJWE(this.state.message, [this.state.did.id]) //  can add others did
      }
      const msg = WakuMessage.fromUtf8String(JSON.stringify({
        message: jwe,
        from: this.state.did.id
      }), this.state.name);
      await this.state.waku.relay.send(msg);
    } catch(err){
      console.log(err)
    }
  }

  handleOnChange = (e) => {
    e.preventDefault();
    this.setState({
      message: e.target.value
    });
  }

  handleOnChangeToDid = (e) => {
    e.preventDefault();
    this.setState({
      toDid: e.target.value
    });
  }

  /*
  addPubKey = async () => {
    try{
      const contract = this.state.contract;
      const web3 = this.state.web3;
      await contract.methods.addPubKey(web3.utils.fromAscii(this.state.pubKey)).send({
        from: this.state.coinbase
      });
    } catch(err){
      console.log(err)
    }
  }
  */

  render(){
    return (
      <ChakraProvider theme={theme}>
        <Box textAlign="center" fontSize="xl">
          <Grid minH="100vh" p={3}>
            <ColorModeSwitcher justifySelf="flex-end" />
            <VStack spacing={8}>
              <Logo h="40vmin" pointerEvents="none" />
              <Text>
                Edit <Code fontSize="xl">src/App.js</Code> and save to reload.
              </Text>
              {
                (
                  !this.state.coinbase ?
                  (
                    <Button
                      onClick={this.connectWeb3}
                    >
                      Connect Web3
                    </Button>
                  ) :
                  (
                    <>
                    <p>Connected as {this.state.coinbase}</p>
                    <p>DID: {this.state.did?.id}</p>
                    <Input placeholder="To DID (optional)"onKeyUp={this.handleOnChangeToDid} />
                    <Input placeholder="Message" onKeyUp={this.handleOnChange} />
                    <Button
                      onClick={this.post}
                    >
                      Add Message
                    </Button>
                    </>
                  )
                )
              }

                <Tabs>
                  <TabList>
                    <Tab>Encrypted Messages</Tab>
                    <Tab>Decrypted Messages</Tab>
                  </TabList>

                <TabPanels>
                  <TabPanel>
                    <VStack spacing={12}>
                    {
                      this.state.messages.map(item => {
                        return(
                          <>
                          <p>Message:</p>
                          <Box style={{overflow: 'auto', width: '600px'}}>
                            {item.payloadAsUtf8}
                          </Box>
                          </>
                        )
                      })
                    }
                    </VStack>
                  </TabPanel>
                  <TabPanel>
                    <VStack spacing={12}>
                    {
                      this.state.decmessages.map(item => {
                        return(
                          <>
                          <p>Decrypted message:</p>
                          <Box style={{overflow: 'auto', width: '600px'}}>
                            {item}
                          </Box>
                          </>
                        )
                      })
                    }
                    </VStack>
                  </TabPanel>
                </TabPanels>
              </Tabs>


            </VStack>
          </Grid>
        </Box>
      </ChakraProvider>
    );
  }
}

export default App;
