$(function () {
  'use strict';

  var urlBase = "http://manager.epbx.com.br/Service/",
    urlSignalr = urlBase + "signalr",
    urlWebApi = urlBase + "api/",
    urlToken = urlBase + "oauth2/Token",
    clientId = "abc",
    windowHandler = $(window),
    timeoutRefreshTokenId,
    StatusDiscagemExterno = {
      "-2": "Desconhecido",
      "-1": "NaoAtende",
      "0": "Ocupado",
      "1": "Congestionamento",
      "2": "Servico",
      "3": "RamalDesligou"
    }

  var atendimentoHubProxy = $.connection.atendimentoHub,
    epbxManagerClient = {
      eventPrefix: "atendimento-",
      events: {},
      StatusDiscagemExterno: StatusDiscagemExterno,
      TipoLogon: atendimentoHubProxy.TipoLogon,
      ramalInfo: null
    };

  $.epbxManagerClient = epbxManagerClient;

  var parseSession = function (name) {
    return name ? JSON.parse(sessionStorage.getItem(name)) : null;
  }


  var getAccessToken = function () {
    return parseSession("tokenData")?.access_token;
    //return epbxManagerClient.token.access_token;
  }

  var saveInfoRamal = function (data) {
    epbxManagerClient.ramalInfo = data;
  }

  var getRamalInfo = function () {
    return $.ajax({
      type: "GET",
      url: urlWebApi + 'Ramal/Info',
      headers: {
        Authorization: 'Bearer ' + getAccessToken()
      },
      contentType: "application/json; charset=utf-8",
    }).then(saveInfoRamal);
  }

  var saveAccessToken = function (tokenData) {
    if (tokenData) {
      epbxManagerClient.token = tokenData;

      sessionStorage.setItem("tokenData", JSON.stringify({
        ...tokenData, 
        expireDt: new Date(new Date().getTime() + (Math.floor(tokenData.expires_in * 0.7) * 1000))
      }));

      // agendamos para realizar o refresh do token antes de expirar:
      timeoutRefreshTokenId = setTimeout(epbxManagerClient.refreshToken, Math.floor(tokenData.expires_in * 0.7) * 1000)

      return tokenData;
    }
    throw new Error("Login invalido");
  }

  epbxManagerClient.loadStorage = function () {
    return new Promise(async function(res, rej) {
      try {
        let tokenData = parseSession("tokenData"),
        lastEvent = parseSession("lastEvent"),
        openPage = parseSession("openPage");
        if (tokenData) {

          if (new Date().getTime() >= new Date(tokenData.expireDt).getTime()) {
            await epbxManagerClient.refreshToken()
          } else {
            $.connection.hub.qs = {
              "access_token": getAccessToken()
            }
          }
          epbxManagerClient.ipPaOrIpOrRamal = "0"
          epbxManagerClient.tipoLogon = epbxManagerClient.TipoLogon.RamalVirtual

          await getRamalInfo();
          await epbxManagerClient.conectarSignalr();
          await epbxManagerClient.iniciarAtendimento();

          if ($.connection.hub.qs && openPage && lastEvent) {
            atendimentoHubProxy.client[openPage.event](openPage.args, 'as object');
            atendimentoHubProxy.client[lastEvent.event](lastEvent.args, 'as object');
            res()
          }


          /*if (new Date().getTime() >= new Date(tokenData.expireDt).getTime()) {
            epbxManagerClient.refreshToken()
            .then(getRamalInfo)
            .then(epbxManagerClient.conectarSignalr)
            .then(epbxManagerClient.iniciarAtendimento)
            .then(function() {
              if ($.connection.hub.qs && openPage && lastEvent) {
                atendimentoHubProxy.client[openPage.event](openPage.args, 'as object');
                atendimentoHubProxy.client[lastEvent.event](lastEvent.args, 'as object');
                res()
              }
            })
          } else {

            if ($.connection.hub.qs && openPage && lastEvent) {
              atendimentoHubProxy.client[openPage.event](openPage.args, 'as object');
              atendimentoHubProxy.client[lastEvent.event](lastEvent.args, 'as object');
              res()
            }
          }*/
        }
      } catch (e) {
        rej(e);
      }
    })
  };
  
  // 1Âº Ã© necessÃ¡rio logar o usuÃ¡rio e adquirir um Access Token para poder acessar a WebApi e o Signalr...
  epbxManagerClient.login = function (username, password, ipPaOrIpOrRamal, tipoLogon) {
    epbxManagerClient.ipPaOrIpOrRamal = ipPaOrIpOrRamal; // salvar o ip para passar ao metodo iniciar do atendimento
    epbxManagerClient.tipoLogon = tipoLogon;


    return $.ajax({
      url: urlToken,
      type: "POST",
      data: {
        grant_type: "password",
        username: username,
        password: password,
        client_id: clientId
      }
    }).then(saveAccessToken).then(getRamalInfo);
  }

  // 2Âº apÃ³s adquirir o AccessToken, podemos conectar no Signalr com websocket (ou server events / long polling, dependerÃ¡ do suporte do browser)
  epbxManagerClient.conectarSignalr = function conectarSignalr() {
    // referencia signalr: http://www.asp.net/signalr/overview/guide-to-the-api/hubs-api-guide-javascript-client
    $.connection.hub.url = urlSignalr;
    $.connection.hub.logging = true;
    $.connection.hub.qs = {
      "access_token": getAccessToken()
    } // autenticaÃ§Ã£o

    return $.connection.hub.start();
  }

  // 3Âº apÃ³s conectarmos no signalr, podemos iniciar o atendimento, para podemos realizar e receber chamadas
  epbxManagerClient.iniciarAtendimento = function iniciarAtendimento() {
    // metodo iniciar do atendimento, passando o ip onde o softphone estÃ¡ logado

    var ramal = epbxManagerClient.ramalInfo.Numero;

    return epbxManagerClient.server.iniciar(ramal, epbxManagerClient.tipoLogon);
  }

  // 4Âº apÃ³s conectarmos no atendimento, podemos chamar e receber eventos do Atendimento/Telefonia.
  //  Abaixo preparmos o recebimentos destes eventos

  // preparar eventos signalr
  // a classe server contem todos os metodos que podemos chamar no servidor
  epbxManagerClient.server = atendimentoHubProxy.server;

  // setup dos eventos que podem vir do servidor.
  // Pode ser feito apÃ³s a conexao tambem,
  // porem Ã© necessario no minimo um evento para que o signalr possa criar o proxy client automaticamente de forma correta
  // ex: atendimentoHubProxy.client.noop = function noop() { }

  epbxManagerClient.desconectar = function desconectar() {
    if ($.connection.hub.state !== $.signalR.connectionState.disconnected) {
      $.connection.hub.stop();
    }
    epbxManagerClient.token = null;
  }

  var createEventHandler = function createEventHandler(eventName) {
    // adicionar evento na lista de eventos. Permite que o client deste objeto chame $(window).on(epbxManagerClient.events.onLogado, function(){});
    epbxManagerClient.events[eventName] = epbxManagerClient.eventPrefix + eventName;
    return function () {
      // usamos o jquery para gerar um evento para a pagina
      // tratativa de argumento armazenado em session
      let args = arguments[1] == 'as object' ? arguments[0] : arguments;

      console.log($.makeArray(args));
      if (eventName != 'onSignalrDisconnected')sessionStorage.setItem("lastEvent", JSON.stringify({event: eventName, args: $.makeArray(args)}));
      return windowHandler.trigger(epbxManagerClient.events[eventName], arguments[1] == 'as object' ? args : $.makeArray(args));
    }
  }

  atendimentoHubProxy.client.onLogado = createEventHandler("onLogado");
  atendimentoHubProxy.client.onLogadoErro = createEventHandler("onLogadoErro");
  atendimentoHubProxy.client.onConexaoErro = createEventHandler("onConexaoErro");
  atendimentoHubProxy.client.onDeslogado = createEventHandler("onDeslogado");
  atendimentoHubProxy.client.onDisca = createEventHandler("onDisca");
  atendimentoHubProxy.client.onDiscaStatus = createEventHandler("onDiscaStatus");
  atendimentoHubProxy.client.onDiscaErro = createEventHandler("onDiscaErro");
  atendimentoHubProxy.client.onChamada = createEventHandler("onChamada");
  atendimentoHubProxy.client.onChamadaGlobalId = createEventHandler("onChamadaGlobalId");
  atendimentoHubProxy.client.onChamadaPerdida = createEventHandler("onChamadaPerdida");
  atendimentoHubProxy.client.onAtendido = createEventHandler("onAtendido");
  atendimentoHubProxy.client.onDesliga = createEventHandler("onDesliga");
  atendimentoHubProxy.client.onChamadaTransferida = createEventHandler("onChamadaTransferida");
  atendimentoHubProxy.client.onChamadaEntrouNaFila = createEventHandler("onChamadaEntrouNaFila");
  atendimentoHubProxy.client.onChamadaSaiuDaFila = createEventHandler("onChamadaSaiuDaFila");
  atendimentoHubProxy.client.onNumerosSigaMeMultiplo = createEventHandler("onNumerosSigaMeMultiplo");
  atendimentoHubProxy.client.onInicioIntervalo = createEventHandler("onInicioIntervalo");
  atendimentoHubProxy.client.onTerminoIntervalo = createEventHandler("onTerminoIntervalo");
  atendimentoHubProxy.client.onInicioNaoDisponivel = createEventHandler("onInicioNaoDisponivel");
  atendimentoHubProxy.client.onTerminoNaoDisponivel = createEventHandler("onTerminoNaoDisponivel");
  atendimentoHubProxy.client.onInicioEspera = createEventHandler("onInicioEspera");
  atendimentoHubProxy.client.onTerminoEspera = createEventHandler("onTerminoEspera");
  atendimentoHubProxy.client.onEntrouEmConferencia = createEventHandler("onEntrouEmConferencia");
  atendimentoHubProxy.client.onConferenciaInicio = createEventHandler("onConferenciaInicio");
  atendimentoHubProxy.client.onConferenciaTermino = createEventHandler("onConferenciaTermino");
  atendimentoHubProxy.client.onConferenciaDisca = createEventHandler("onConferenciaDisca");
  atendimentoHubProxy.client.onConferenciaDiscaErro = createEventHandler("onConferenciaDiscaErro");
  atendimentoHubProxy.client.onConferenciaAtendido = createEventHandler("onConferenciaAtendido");
  atendimentoHubProxy.client.onConferenciaChamadaEncerrada = createEventHandler("onConferenciaChamadaEncerrada");
  atendimentoHubProxy.client.onConferenciaErro = createEventHandler("onConferenciaErro");
  atendimentoHubProxy.client.onInfoIntervaloRamal = createEventHandler("onInfoIntervaloRamal");
  atendimentoHubProxy.client.onAlterarIntervaloTipoErro = createEventHandler("onAlterarIntervaloTipoErro");
  atendimentoHubProxy.client.onSetIntervaloRamal = createEventHandler("onSetIntervaloRamal");
  atendimentoHubProxy.client.onConsultaAtendido = createEventHandler("onConsultaAtendido");
  atendimentoHubProxy.client.onConsultaChamada = createEventHandler("onConsultaChamada");

  // avisamos a pagina da quebra de conexao com o Signalr
  $.connection.hub.disconnected(createEventHandler("onSignalrDisconnected"));

  // atualizar o token de acesso.
  // para que nÃ£o haja problema em navegadores que nÃ£o suportem websocket, chamar essa funcao antes do token expirar.
  epbxManagerClient.refreshToken = function refreshToken() {
    if (timeoutRefreshTokenId) clearTimeout(timeoutRefreshTokenId);
    let tokenData = parseSession("tokenData");
    //epbxManagerClient.token.refresh_token
    return $.ajax({
      url: urlToken,
      type: "POST",
      data: {
        grant_type: "refresh_token",
        refresh_token: tokenData?.refresh_token,
        client_id: clientId
      }
    })
      .then(saveAccessToken)
      .then(function () {
        $.connection.hub.qs = {
          "access_token": getAccessToken()
        }
      })
      .fail(function (errData) {
        console.error("Houve um problema para realizar o refresh_token");
        $.connection.hub.qs = {};
        console.log(errData);
      });
  };

  // funÃ§Ã£o para buscar o arquivo mp3 da chamada
  epbxManagerClient.getUrlDownloadChamada = function (globalId) {
    var urlDownload = urlWebApi + "Ligacao/Download/";
    var params = {
      token_type: 'bearer',
      access_token: getAccessToken()
    };
    return [urlDownload + globalId, $.param(params)].join('?');
  };

  epbxManagerClient.getTipoDiscagem = function (checkbox) {
    return checkbox.is(":checked") ? atendimentoHubProxy.TipoDiscagem.LigacaoExterna : atendimentoHubProxy.TipoDiscagem.LigacaoRamal;
  };


  epbxManagerClient.relogarRamal = function (recall) {
    recall = recall || function (value) { return value; };
    epbxManagerClient.server.iniciar(epbxManagerClient.ipPaOrIpOrRamal, epbxManagerClient.tipoLogon).then(recall);
  };

  // inserir um wrapper em volta de todas as funÃ§Ãµes de atendimento para tratar os casos em que o ramal nÃ£o estÃ¡ logado no Atendimento
  function checkErroRamalNaoLogado(err, recall) {
    if (err.message === 'Ramal nÃ£o logado no Atendimento') {
      //alert('relogar ramal')
      epbxManagerClient.relogarRamal(recall);
    }
  }

  function replaceFunction(originalFunction) {
    return function () {
      var args = arguments;
      var originalFunctionCall = function () {
        return originalFunction.apply(this, args);
      }
      return originalFunctionCall().fail(function (err) {
        checkErroRamalNaoLogado(err, originalFunctionCall);
      });
    }
  }

  for (var functionName in atendimentoHubProxy.server) {
    atendimentoHubProxy.server[functionName] = replaceFunction(atendimentoHubProxy.server[functionName]);
  }

  // listar no console as funcoes disponiveis no server:
  //(function(){
  //    var key, value
  //    for(key in atendimentoHubProxy.server) {
  //        console.log(atendimentoHubProxy.server[key])
  //    }
  //})();

  epbxManagerClient.Agendamento = function (obj, callbackSucesso, callbackError) {

    var data = {
      Campanha: obj.CampanhaId,
      CodCliente: obj.CodCliente,
      DDD: obj.DDD,
      Telefone: obj.Telefone,
      DataHora: obj.DataHora,
      Ramal: obj.Ramal,
      NomeCliente: obj.NomeCliente
    };

    $.ajax({
      type: "POST",
      url: urlWebApi + 'Atendimento/Agendamento',
      data: JSON.stringify(data),
      headers: {
        Authorization: 'Bearer ' + getAccessToken()
      },
      contentType: "application/json; charset=utf-8",
      success: callbackSucesso,
      error: callbackError
    });
  };

  epbxManagerClient.CaixaPostal = function (obj, callbackSucesso, callbackError) {

    var data = {
      Campanha: obj.CampanhaId,
      CodCliente: obj.CodCliente,
      DDD: obj.DDD,
      Telefone: obj.Telefone,
      DtHoraPrioridade: obj.DataHora,
      Ramal: obj.Ramal,
      NomeCliente: obj.NomeCliente
    };

    $.ajax({
      type: "POST",
      url: urlWebApi + 'Atendimento/CaixaPostal',
      data: JSON.stringify(data),
      headers: {
        Authorization: 'Bearer ' + getAccessToken()
      },
      contentType: "application/json; charset=utf-8",
      success: callbackSucesso,
      error: callbackError
    });
  };

  epbxManagerClient.ContatoNegativo = function (obj, callbackSucesso, callbackError) {

    var data = {
      Campanha: obj.CampanhaId,
      CodCliente: obj.CodCliente,
      DDD: obj.DDD,
      Telefone: obj.Telefone,
      Prioridade: obj.Prioridade
    };

    $.ajax({
      type: "POST",
      url: urlWebApi + 'Atendimento/ContatoNegativo',
      data: JSON.stringify(data),
      headers: {
        Authorization: 'Bearer ' + getAccessToken()
      },
      contentType: "application/json; charset=utf-8",
      success: callbackSucesso,
      error: callbackError
    });
  };

  epbxManagerClient.ImportacaoLote = function (campanhaId, lista, callbackSucesso, callbackError) {

    $.ajax({
      type: "POST",
      url: urlWebApi + 'CampanhaDiscagem/Lote?campanhaId=' + campanhaId,
      data: JSON.stringify(lista),
      headers: {
        Authorization: 'Bearer ' + getAccessToken()
      },
      contentType: "application/json; charset=utf-8",
      success: callbackSucesso,
      error: callbackError
    });
  };





});